<div align="center">

# Python Simple Video Meeting App

![BW_all](../../.readme_images/BW_all.png)

</div>
This sample app shows how to use our Video and Voice APIs to create a basic multi-person, multi-'room' video application using NodeJS and minimalist browser-side Javascript.

This application includes some other nice-to-have features, such as:

- Screensharing
- A 'vanity mirror' that shows your local video stream
- Mic picker
- Cam picker
- Phone Dial out

## Pre-Reqs

You will need to set up Bandwidth Applications and have phone numbers associated with these application, and point the callback URL on these applications to the messaging and voice endpoints on the server running this app. `ngrok` is highly recommended for local prototyping.

## Architecture Overview

This app runs an HTTP server that listens for requests from browsers to get connection information. This connection information tells a browser the unique ID it should use to join a Room.

The server connects to Bandwidth's HTTP WebRTC API, which it will use to create a session and participant IDs. This example leverages our Node SDK to make the WebRTC calls.

The web browser will also use a websocket managed by the WebRTC browser SDK to handle signaling to the WebRTC API - this is all handled by a prepackaged Javascript SDK. Once more than one browser has joined the conference, they will be able to talk to each other.

> Note: Unless you are running on `localhost`, you will need to use HTTPS. Most modern browsers require a secure context when accessing cameras and microphones.

## How it's laid out

There are two main components to building out this solution: the server side which handles call control and the client side which enables the participant.

### Server side

The only file here is `app.py` which includes the Bandwidth WebRTC sdk.

There are several endpoints that are exposed by this file for browser consumption:

- `/joinCall` allows a browser to join a call
- `/startPSTNCall` dials out to a phone and has it join an active call
- `/endPSTNCall` is NOT exposed in this example browser interface
- `/idLookup` allows a browser to lookup a caller's/participant's name based on their participant_id

There are also some endpoints not intended for the browser

- `/Callbacks/answer` is called by the Bandwidth Voice system to determine what to do with an initiated call that has been answered
- `/endSession` would be called to terminate a session, this could be called by some control system.

The meat of `/joinCall` is a call to the `addParticipantToRoom()` function which does the following:

- Gets a session id - either by creating a session or by getting the `session_id` from an internal list of `session_id`s stored by `room_name`
- Creates a new participant via `createParticipant()`, returning a token used for later authentication
- Calls `addParticipantToSession()` with a session level subscription - doing this means that everyone is subscribed to this participant and this participant is subscribed to everyone else. As people are added or removed subscriptions will be managed for you.
- Returns the participant token (from `createParticipant()`) to the web user that is needed to start connect to the WebRTC server and start streaming

The `/startPSTNCall` works in a similar fashion to `/joinCall` except it initiates a call via the Voice API and rather than passing back a token, it stores it for later use when the call is answered - as seen in `/Callbacks/answer`.

`/endSession` ends the session by removing everyone from it. As a reminder, sessions are only billed when media is flowing and all sessions are automatically ended and purged after 9 hours.

### Client Side

There is a bit more going on in the javascript side, much of this isn't needed to get a basic session going. But since we are creating a basic (but admitidly ugly) video meeting system, there is more going on. We're not going to go into the details that aren't pertinent to setting up WebRTC sessions here.

There is one html file, `index.html` with very little going on, it just sets the stage. `main.js` handles most of the meeting logic and `webrtc_mgr.js` handles most audio and video work and interacting with the WebRTC SDK.

The most important elements of getting a browser user online are:

- Getting your participant token from your Call Control server application (above), this is accomplished in the `getOnline()` function.
- Next `startSreaming()`, which calls `bandwidthRtc.connect();` - this establishes a connection with the WebRTC servers
- After the browser is connected, some work is done to setup our `constraints` which tell the browser which devices to use and any constraints around the encodings, rates, resolutions, etc. of the media
- Once that is all set, we can start flowing media out by calling `bandwidthRtc.publish()` with the constraints we just created

There is one other section that is of particular importance here, it's this section:

```
window.addEventListener("load", (event) => {
  bandwidthRtc.onStreamAvailable((rtcStream) => {
    connectStream(rtcStream);
  });

  bandwidthRtc.onStreamUnavailable((endpointId) => {
    disconnectEndpoint(endpointId);
  });
});
```

This section creates the listeners that will fire whenever a new stream is attached or disconnected from this browser. The implementation here creates a new `<video>` element and places it within the DOM. We add each stream to a list of connected streams as well.

You'll note that in the `disconnectEndPoint` function we also check if this was the last person we were connected to. If so, we tell the user we are all done. This isn't necessary, but may be useful if you are doing small group calls and want to inform the user that the call is over.

## Running The App

### Environmental Variables

The following configuration variables need to be set, start by coping the `config.ini.default` file to `config.ini`. For more information about each variable. Read more about each variable on the [Security & Credentials Documentation Page](https://dev.bandwidth.com/guides/accountCredentials.html#top).

Note that we have hardcoded the FROM and TO here. You may wish to make your FROM numbers dynamic based on the customer you are serving (or not!). The TO will almost definitely be dynamic, but in order to reduce accidental dialing or abuse, we have hardcoded it here. You can easily make this a dynamic variable, doing so is evident from looking at the code.

| Variable               | Description                                                       | Example                                |
| :--------------------- | :---------------------------------------------------------------- | :------------------------------------- |
| `account_id`           | Your Bandwidth Account Id                                         | `539525`                               |
| `api_user`             | Your Bandwidth API Username                                       | `johnDoe`                              |
| `api_password`         | Your Bandwidth API Password                                       | `hunter22`                             |
| `voice_application_id` | Your Bandwidth Voice application ID                               | `acd1575d-b0f7-4274-95ee-e942a286df8c` |
| `base_callback_url`    | The url for your dev server, with ending /                        | `https://e8b0c1c2a03e.ngrok.io/`       |
| `from_number`          | The "From" caller Id number for your call                         | `+13428675309`                         |
| `dail_number`          | the number to dial out to when you click "Dial Out" in the Web UI | `+14835552343`                         |

### Commands

Run the following commands to get started

```
pip install -r requirements.txt

cp config.ini.default config.ini
# edit config.ini per the description above

ngrok http 5000
# update your config.ini to have the ngrok url that is shown on screen
# you'll need to do this every time you restart ngrok if you want callbacks to work
```

```
# leave that open, in a new terminal...
python app.py
```

## What You Can Do

- go to http://localhost:5000 and you will see a basic call interface
- Click "Get Online" to connect your browser to the media server
- Click on "Dial Out" to initiate the PSTN call from the server side and add the PSTN call to the session, this will also transfer the call to the WebRTC session once it has been answered.
- Click "End Call" to remove the participant from the session and end the PSTN call

# Tutorial

## Assumptions

- Have Bandwidth Account
- Have Python (3.7.6+) Installed (along with pip)
- Have [ngrok](https://ngrok.com) installed

## Read through the Code

The code for this example is fairly well documented, so please take a look through it to understand how it works. But here are a few pointers on flow

### General Flow

The path that you take to add people into a WebRTC call is as follows:

- Enter your name (or leave the default)
- Enter a room name (or leave the default, or it can be set in the query string)
- Select your devices from the list, which is autodetected on page load

- Click "Join Your Meeting" to get a token for your browser, get you connected to our media server, and start media flowing from the browser
- Do the same in another browser, with the same room name of course
- Start two other browsers with a different room name
- You can also share your screen

To Dial out to a call:

- click the Dial Out link at the bottom
- It will ask for a phone number and name for the participant
- The demo passes the number info to the server, but ignores it in favor of a value set in a config file
- this can easily be changed to use the number provided; that number will need to be e.164 formatted - meaning it starts with +1 and contains no spaces, hyphens, or other chars, e.g. +15558675309

### Options and Notes

- You can preset a name for the room by putting the query param `room` in the query string of the url - try [http://localhost:5000?room=test%20room](http://localhost:5000?room=test%20room)
- You can autostart all the attendees muted by changing the `start_muted_audio` variable to `true` at the top of `public/webrtc_mgr.js`
  - Note that an unmute button isn't provided in this example though
  - However there are javascript functions in `public/webrtc_mgr.js` for muting and unmuting both audio and video
- There are facilities fo muting audio and video in the webrtc_mgr.js file
- There is an ability to play ringing in the browser (natively in JS) while awaiting your first connection
