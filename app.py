"""
app.py

A simple WebRTC Call control server that shows the basics of
 getting a video call up and running between a browser and an outbound PSTN call

@copyright Bandwidth INC
"""

import sys
import json
import os
import jwt
import configparser
from flask import Flask, request, send_from_directory, Response
# from bandwidth.messaging.models.bandwidth_callback_message import BandwidthCallbackMessage
# from bandwidth.messaging.models.bandwidth_message import BandwidthMessage
from bandwidth.api_helper import APIHelper
from bandwidth.bandwidth_client import BandwidthClient
# from bandwidth.messaging.controllers.api_controller import APIController, ApiResponse
# from bandwidth.messaging.messaging_client import MessagingClient
# from bandwidth.messaging.models.message_request import MessageRequest
from bandwidth.voice.bxml.verbs import PlayAudio, SpeakSentence, Gather, Hangup
from bandwidth.webrtc.web_rtc_client import WebRtcClient
from bandwidth.webrtc.utils.transfer_util import generate_transfer_bxml
from bandwidth.exceptions.api_exception import APIException

config = configparser.ConfigParser()
config.read('config.ini')
try:
    config['bandwidth']['BW_USERNAME']
    config['bandwidth']['BW_PASSWORD']
except error:
    print("Please set the config variables defined in the README", error)
    exit(-1)

bandwidth_client = BandwidthClient(
    voice_basic_auth_user_name=config['bandwidth']['BW_USERNAME'],
    voice_basic_auth_password=config['bandwidth']['BW_PASSWORD'],
    web_rtc_basic_auth_user_name=config['bandwidth']['BW_USERNAME'],
    web_rtc_basic_auth_password=config['bandwidth']['BW_PASSWORD'],
)

app = Flask(__name__)
# track our "rooms" which includes session IDs and phone call Ids
#  - if not a demo, these would be stored in persistant storage
rooms = {}

# track attendee info for easy mapping
attendees = {}

sessionId = False  # get rid of this
# this needs to be saved from PSTN create_participant until the transfer to WebRTC
#  we will also store the token and pstn call_id within this object
pstnParticipant = False  # get rid of this


@app.route("/", methods=["GET"])
def home_page():
    return download_file("index.html")


@app.route("/joinCall", methods=["POST"])
def start_browser_call():
    '''
    Coordinates the steps needed to get a Browser participant online
    1. Create the session
    2. Create the participant
    3. Add the participant to the session
    4. Return the token to the browser so they can use it to connect
    '''
    global attendees

    data = request.get_json()
    print("data is %s" % json.dumps(data))

    if data['room'] is None:
        data['room'] = "lobby"

    # Get/create a session, the tag param is good for billing indicators
    session_id = get_session_id(data['room'], "customer_123")
    if session_id is None:
        return json.dumps({"message": "failed to create session id"})
    print("start_browser_call> created new session, Id: %s, Room: %s" %
          (session_id, data['room']))

    # Create a participant
    print("start_browser_call> setting up '%s'" % data['caller']['name'])
    participant = create_participant(data['caller']['name'], True)

    # keep track of this person
    attendees[participant.id] = data['caller']['name']

    # Add that participant to our session
    add_participant_to_session(session_id, participant.id)

    res = {"message": "created particpant and setup session",
           "token": participant.token, "room": data['room']}
    return json.dumps(res)


@app.route("/startPSTNCall", methods=["POST"])
def start_pstn_call():
    '''
    Similar to start_browser_call, except we are using the session we created previously
    '''
    print("start_pstn_call> setting up PSTN call")
    global pstnParticipant
    global attendees

    data = request.get_json()
    print("data is %s" % json.dumps(data))
    print("calling '%s'" % data["callee"]['name'])

    # fix this, we need to lookup the id for this call
    room_name = data['room']

    session_id = get_session_id(room_name, "customer_123")
    if session_id is None:
        return json.dumps({"message": "didn't find and existing session Id for PSTN call"})

    pstnParticipant = create_participant(data["callee"]['name'], False)

    add_participant_to_session(session_id, pstnParticipant.id)

    # keep track of this person
    attendees[pstnParticipant.id] = data['callee']['name']

    # From number does not have to be a Bandwidth number
    #  - though you *must* use a valid number that you have the authority to start calls from
    pstnParticipant.call_id = initiate_call_to_pstn(
        config['outbound_call']['FROM_NUMBER'], config['outbound_call']['TO_NUMBER'])

    res = {"status": "ringing"}
    return json.dumps(res)


@app.route("/Callbacks/answer", methods=["POST", "GET"])
def voice_callback():
    '''
    Transfer this pstn call to a WebRTC session
    This is invoked by a callback from BAND when the caller answers the phone.
    This URL was specified as our 'answerUrl' in initiate_call_to_pstn()
    The session it should join was specified when we called add_participant_to_session()
    '''
    global pstnParticipant
    print("voice_callback>Received answer callback")
    bxml = generate_transfer_bxml(pstnParticipant.token).strip()
    return Response(bxml, content_type='text/xml')


@app.route("/endPSTNCall", methods=["GET"])
def end_pstn_call():
    '''
    End the PSTN call
    '''
    global pstnParticipant
    print("end_pstn_call> hangup up on PSTN call")
    end_call_to_pstn(config['bandwidth']['BW_ACCOUNT_ID'],
                     pstnParticipant.call_id)
    res = {"status": "hungup"}
    return json.dumps(res)


@app.route("/idLookup", methods=["GET"])
def get_name_from_id():
    '''
    Get the name of a participant from the participant_id in the media object
    '''
    id = request.args['id']
    res = {"attendee": attendees[id]}

    return json.dumps(res)


#  ------------------------------------------------------------------------------------------
#  All the functions for interacting with Bandwidth WebRTC services below here
#


def save_session_id(room_name, session_id):
    '''
    Save the session id so we can reference it on subsequent calls
    :param string room_name
    :param string session_id
    '''
    # saved globally for simplicity of demo
    global rooms
    rooms[room_name] = {"session_id": session_id}


def get_session_id(room_name, tag):
    '''
    Return the sessionId if it has already been created,
    create a new one, if one doesn't already exist
    Store the session Id in the global sessionId variabe (this is a stand in for persistent storage)
    :param name The human readable "name" of the call for this demo
    :param tag a tag to apply to this session, can be useful for billing categorization
    :return: the session id
    :rtype: string
    '''
    if room_name in rooms:
        return rooms[room_name]["session_id"]

    # No pre-existing session, create a new on
    body = {
        "tag": tag
    }
    try:
        print(
            f"Calling out to createSession for account#{config['bandwidth']['BW_ACCOUNT_ID']} with body: {json.dumps(body)} ")
        webrtc_client: APIController = bandwidth_client.web_rtc_client.client
        api_response: ApiResponse = webrtc_client.create_session(
            config['bandwidth']['BW_ACCOUNT_ID'], body)

        save_session_id(room_name, api_response.body.id)
        return api_response.body.id
    except APIException as e:
        print("get_session_id> Failed to create a session: %s" % e.response.text)
        return None


def create_participant(tag, allowVideo):
    '''
    Create a new participant
    :param tag to tag the participant with, no PII should be placed here
    :param allowVideo true if they should have video, false for just audio
    :return a participant json object, which contains the token
    Note that adding VIDEO permission to an audio only stream my cause issues
    '''
    if allowVideo:
        perms = ["AUDIO", "VIDEO"]
    else:
        perms = ["AUDIO"]
    body = {
        "tag": tag,
        "publishPermissions": perms,
    }
    try:
        webrtc_client: APIController = bandwidth_client.web_rtc_client.client
        api_response: ApiResponse = webrtc_client.create_participant(
            config['bandwidth']['BW_ACCOUNT_ID'], body)

        participant = api_response.body.participant
        participant.token = api_response.body.token
        return participant

    except APIException as e:
        print("create_participant> Failed to create a participant: %s" %
              e.response.text)
        return None


def add_participant_to_session(session_id, participant_id):
    '''
    Add a newly created participant to a session
    :param session_id
    :param participant_id
    :return none
    '''
    body = {
        "sessionId": session_id
    }
    try:
        webrtc_client: APIController = bandwidth_client.web_rtc_client.client
        api_response: ApiResponse = webrtc_client.add_participant_to_session(
            config['bandwidth']['BW_ACCOUNT_ID'], session_id, participant_id, body)

        return None

    except APIException as e:
        print("add_participant_to_session> Failed to add participant to session: %s" %
              e.response.text)
        return None


def initiate_call_to_pstn(from_number, to_number):
    '''
    Start a call to the PSTN using our Voice APIs
    :param from_number the number that shows up in the "caller id"
    :param to_number the number you want to call out to
    '''
    voice_client: APIController = bandwidth_client.voice_client.client
    # Create phone call
    body = {
        "from": from_number,
        "to": to_number,
        "applicationId": config['bandwidth']['BW_VOICE_APPLICATION_ID'],
        "answerUrl": config['server']['BASE_CALLBACK_URL'] + "Callbacks/answer",
        "callTimeout": 30
    }

    try:
        response = voice_client.create_call(
            config['bandwidth']['BW_ACCOUNT_ID'], body=body)
        return response.body.call_id
    except APIException as e:
        print(
            f"initiate_call_to_pstn> Failed to call out [{e.response_code}] {e.description} ")


def end_call_to_pstn(call_id):
    '''
    End the call to the PSTN using our Voice APIs
    :param BW_ACCOUNT_ID
    :param call_id
    '''
    voice_client: APIController = bandwidth_client.voice_client.client
    body = {
        "state": "completed"
    }
    try:
        response = voice_client.modify_call(
            config['bandwidth']['BW_ACCOUNT_ID'], call_id, body=body)
        return None
    except APIException as e:
        print(
            f"end_call_to_pstn> Failed to end call [{e.response_code}] {e.description} ")


@ app.route('/public/<path:filename>')
def download_file(filename):
    '''
    Serve static files
    '''
    print("file request for:" + filename)
    return send_from_directory('public', filename)


if __name__ == '__main__':
    app.run(debug=True)
