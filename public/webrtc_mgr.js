const bandwidthRtc = new BandwidthRtc();
//
// configuration
// a div to append new media elements to (video or audio)
//  not needed if you implement onNewStream
const mediaDiv = false;

// set to false if you just want audio connections
const videoEnabled = true;

// ring while waiting for first connection
const enableRinging = false;

// when media connects, mute mics by default
const start_muted_audio = false;

//
//  internal global vars, don't set these
// universal id for the call (the server tells us this), aka room name
let internal_call_id = "";

// tracks who you're in the call with
let other_callers = [];

// global vars
var my_media_stream; // main webrtc stream
var my_screen_stream; // for screenshare
var local_video_stream = false; // for vanity mirror

/**
 * Get the token required to auth with the media server
 * Use that token to start streaming
 * @param call_info json object with the following
 *  caller: {name: "callers name"}
 *  call_type: phone", or "push"
 *  room: room_name
 *  audio: true OR false (usually true)
 *  video: true OR false
 */
async function getOnline(call_info) {
  console.log("Fetching token from server for: ");
  console.log(call_info);

  updateStatus("Call Setup");
  try {
    // call your server function that does call control
    var res = await fetch("/joinCall", {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(call_info),
    });
  } catch (error) {
    console.log(`getOnline> error on fetch ${error}`);
    return;
  }
  // basic error handling
  if (res.status !== 200) {
    alert("getOnline> got back non-200: " + res.status);
    console.log(res);
  } else {
    const json = await res.json();
    console.log(json);

    // save this for later use to sign off gracefully
    internal_call_id = json.room;

    // ring if desired, ring until someone joins
    if (enableRinging) {
      playAudio("ring", "/ring.mp3");
    }

    startStreaming(json.token, call_info);
  }
}

/**
 * Now that we have the token, we can start streaming media
 * The token param is fetched from the server above
 */
async function startStreaming(token, call_info) {
  // Connect to Bandwidth WebRTC
  await bandwidthRtc.connect({ deviceToken: token });
  console.log("connected to bandwidth webrtc!");
  //
  // Publish the browser's microphone and video if appropriate
  // set the video constraints
  var video_constraints = false;
  if (call_info.video) {
    video_constraints = {
      width: { min: 320, max: 640 },
      height: { min: 240, max: 480 },
      aspectRatio: 1.777777778,
      frameRate: { max: 30 },
    };

    if (call_info.video_device == "none") {
      video_constraints = false;
    } else if (call_info.video_device != "default") {
      updateStatus(`Using ${call_info.video_device} for cam`);
      video_constraints.deviceId = { exact: call_info.video_device };
    } // if it is default, we'll let getUserMedia decide
  }

  // set the audio constraints
  var audio_constraints = false;
  if (call_info.audio) {
    audio_constraints = {
      echoCancellation: true,
    };
    if (call_info.mic_device == "none") {
      audio_constraints = false;
    } else if (call_info.mic_device != "default") {
      updateStatus(`Using ${call_info.mic_device} for mic`);
      audio_constraints.deviceId = { exact: call_info.mic_device };
    } // if it is default, we'll let getUserMedia decide
  }

  streamResp = await bandwidthRtc.publish(
    {
      audio: audio_constraints,
      video: video_constraints,
    },
    undefined,
    call_info.caller.name
  );
  my_media_stream = streamResp.mediaStream;
  if (start_muted_audio) {
    mute();
  }
  updateStatus("Online...");
  if (typeof isOnline === "function") {
    isOnline(call_info, streamResp.mediaStream);
  }
  console.log(
    `browser mic is streaming with stream id: ${streamResp.mediaStream.id}`
  );
}

/**
 * Check that we have WebRTC permissions
 * - if you .then() this function on your first use of getUserMedia then you can avoid
 */
async function checkWebRTC() {
  // always check real quick that we have access
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (err) {
    console.log(`failed to get webrtc access`);
    console.log(err);
    throw err;
  }
}

/**
 * Start or stop screensharing in an already online/publishing state
 */
async function screenShare() {
  // if we're already sharing, then stop
  if (my_screen_stream) {
    // unpublish
    await bandwidthRtc.unpublish(my_screen_stream.endpointId);

    // stop the tracks locally
    var tracks = my_screen_stream.getTracks();
    tracks.forEach(function (track) {
      console.log(`stopping stream`);
      console.log(track);
      track.stop();
    });
    document.getElementById("screen_share").innerHTML = "Screen Share";

    my_screen_stream = null;
    document.getElementById("share").style.display = "none";
  } else {
    video_constraints = {
      frameRate: 30,
    };
    // getDisplayMedia is the magic function for screen/window/tab sharing
    try {
      my_screen_stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: video_constraints,
      });
    } catch (err) {
      if (err.name != "NotAllowedError") {
        console.error(`getDisplayMedia error: ${err}`);
      }
    }

    if (my_screen_stream != undefined) {
      // we're now sharing, so start, and update the text of the link
      document.getElementById("screen_share").innerHTML = "Stop Sharing";

      // start the share and save the endPointId so we can unpublish later
      var resp = await bandwidthRtc.publish(
        my_screen_stream,
        undefined,
        "screenshare"
      );
      my_screen_stream.endpointId = resp.endpointId;
      document.getElementById("share").style.display = "inline-block";
      document.getElementById("share").onClick = fullScreenShare();
    }
  }
}

/**
 * Ask the server to call out to a phone number
 * could take json object with the following info, for this example we build
 *  the json object in the function...
 *  call_info = {
 *    callee: {name: "callers name/optional", phone_number: "+15558675309"}
 *    room: room_name
 *  }
 *
 *  Note that in this demo, the phone number will be overwridden
 *     on the server side as a safety measure
 */
async function dialPSTN(number, callee) {
  console.log(`not actually calling ${callee} @ ${number}, but a standin`);
  call_info = {
    room: internal_call_id,
    callee: {
      name: callee,
      phone_number: number,
    },
  };

  console.log(
    `dialing out to ${call_info.callee.phone_number} for room ${call_info.room}`
  );
  try {
    // call your server function that does call control
    var res = await fetch("/startPSTNCall", {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(call_info),
    });
  } catch (error) {
    console.log(`getOnline> error on fetch ${error}`);
    return;
  }
  // basic error handling
  if (res.status !== 200) {
    alert("dialPSTN> got back non-200: " + res.status);
    console.log(res);
  } else {
    const json = await res.json();
    console.log(json);

    // ring if desired, ring until someone joins
    if (enableRinging) {
      playAudio("ring", "/ring.mp3");
    }
  }
}

/**
 * Get a name from a participant id
 * @param {*} lookupId
 */
async function participantLookup(lookupId) {
  console.log(`looking up '${lookupId}'`);

  try {
    var res = await fetch("/idLookup?id=" + lookupId);

    // basic error handling
    if (res.status !== 200) {
      console.log(res);
      alert("participantLookup> error on fetch: " + res.status);
      return "None found";
    }
  } catch (error) {
    console.log(`failed to lookup id ${error}`);
    return "Not found";
  }

  const json = await res.json();
  console.log(json);
  return json.attendee;
}

/**
 * Just get this user offline, don't end the session for everyone
 */
async function signOff() {
  // bandwidthRtc.disconnect();
  // Remove all my connections
  //  this function will end up calling bandwidthRtc.disconnect() after the last removal
  console.log(`about to disconnect these fine folks:`);
  let temp_callers = [...other_callers]; // need to make a copy, as we'll be splicing this as we go
  temp_callers.forEach(function (caller) {
    console.log(`disconnecting ${caller}`);
    disconnectEndpoint(caller);
  });
  console.log("Signed off");
}

/**
 * End the current session for all callers (asks the server to do it)
 * uses internal_call_id to know what to end, set when you got online
 */
async function endSession() {
  updateStatus("Ending Call");
  console.log(`Ending session: ${internal_call_id}`);

  try {
    var res = await fetch("/endSession?room_name=" + internal_call_id);

    // basic error handling
    if (res.status !== 200) {
      console.log(res);
      alert("Failed to end your session: " + res.status);
      return;
    } else {
      updateStatus("Call Ended");
    }
  } catch (error) {
    console.log(`failed to end the session ${error}`);
    console.log("we'll keep cleaning up though");
  }

  // clear out any remaining connections
  other_callers.forEach(function (caller) {
    disconnectEndpoint(caller);
  });
}

/**
 * Setup our listeners for the events from the media server
 */
window.addEventListener("load", (event) => {
  bandwidthRtc.onStreamAvailable((rtcStream) => {
    connectStream(rtcStream);
  });

  bandwidthRtc.onStreamUnavailable((endpointId) => {
    disconnectEndpoint(endpointId);
  });
});

/**
 * This is called when a new stream is connected
 * - this sets up the right tag (audio vs video) and connects the media stream to it
 * - it will then do one of:
 *    - pass that element to onNewStream() if you have created that function
 *    - add the element to an pre-existing DOM element named in mediaDiv (top of this file)
 *    - append that new element to the end of the DOM
 * @param {} rtcStream
 */
function connectStream(rtcStream) {
  // check if this is already connected
  if (other_callers.indexOf(rtcStream.endpointId) > -1) {
    console.log(`duplicate receipt of:${rtcStream.endpointId}`);
    return;
  }
  console.log(`receiving media! ${rtcStream.endpointId}`);
  console.log(rtcStream);

  // get the sound/video flowing
  var elType = "audio";
  if (videoEnabled) {
    elType = "video";
  }
  var mediaEl = document.createElement(elType);
  mediaEl.id = rtcStream.endpointId;
  mediaEl.autoplay = true;
  mediaEl.srcObject = rtcStream.mediaStream;

  // keep track of the streams we're connected to
  other_callers.push(rtcStream.endpointId);

  // clean up any ringing audio
  stopAudio("ring");
  // update status
  updateStatus("In Call");

  // either append it to mediaDiv, or give it back to the calling script/file
  if (typeof onNewStream === "function") {
    onNewStream(mediaEl, rtcStream);
  } else {
    if (mediaDiv) {
      document.getElementById(mediaDiv).appendChild(mediaEl);
    } else {
      document.body.appendChild(mediaEl);
    }
  }
}
function disconnectEndpoint(endpointId) {
  console.log(`disconnecting endpoint: ${endpointId}`);

  // if this endpoint is still active on the call
  if (other_callers.indexOf(endpointId) > -1) {
    removeCaller(endpointId);
    // if there is no one left in the call
    if (other_callers.length == 0) {
      updateStatus("Call Ended");
      console.log(`All callers are off the line, ending call`);
      bandwidthRtc.disconnect();
      if (typeof allCallsEnded != "undefined") {
        allCallsEnded();
      }
    }

    // call any external functions setup for this
    if (typeof onEndStream === "function") {
      onEndStream(endpointId);
    }
  } else {
    console.log(
      `Disconnect for ${endpointId} but have no media for, common repeat notice`
    );
  }
}
/**
 * Removes this caller from your call
 *  - removes caller from other_callers list
 *  - removes Audio element for this caller
 * @param {*} id
 */
function removeCaller(id) {
  let index = other_callers.indexOf(id);
  if (index > -1) {
    other_callers.splice(index, 1);
    audioElement = document.getElementById(id);
    audioElement.srcObject = undefined;
    audioElement.remove();
  }
}

/**
 * Show a "vanity" view of your camera as it will be displayed to
 *  other participants
 * @param {string} cam_device the device id for the device to stream from (list available via listCameras)
 * @param {string} video_id the dom element id that we should make this video a child of
 * @param {json} video_constraints Any additional video constraints you'd like to add to this video
 */
async function show_vanity_mirror(
  cam_device,
  video_id,
  video_constraints = {}
) {
  // disable any current device, this is important to turn off the cam (and it's led light)
  disable_vanity_mirror();

  // allows for an option like "disable" in the cam selector
  if (cam_device == "none") {
    video_constraints = false;
    document.getElementById(video_id).srcObject = null;
    return;
  } else {
    video_constraints.deviceId = {
      width: { min: 320, max: 640 },
      height: { min: 240, max: 480 },
      aspectRatio: 1.777778,
      frameRate: { max: 30 },
      exact: cam_device,
    };
  }

  try {
    local_video_stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: video_constraints,
    });
    document.getElementById(video_id).srcObject = local_video_stream;
  } catch (error) {
    console.log(`Failed to acquire local video: ${error.message}`);
    console.log(error);
    alert("Sorry, we can't proceed without access to your camera");
  }
}

/**
 * Stop the camera and showing it in the corner
 */
function disable_vanity_mirror() {
  if (local_video_stream) {
    var tracks = local_video_stream.getTracks();
    tracks.forEach(function (track) {
      console.log("stopping track");
      track.stop();
    });
  }
}

//
// manage inputs
async function getCameras() {
  return await bandwidthRtc.getVideoInputs();
}
async function getMics() {
  return await bandwidthRtc.getAudioInputs();
}

//
// Manipulate the media streams
/**
 * Mutes the mic, note that this assumes one mic stream
 */
function mute() {
  set_mute_all("audio", true);
}
function unmute() {
  set_mute_all("audio", false);
}
/**
 * 'Mutes' the camera
 */
function video_mute() {
  set_mute_all("video", true);
}
function video_unmute() {
  set_mute_all("video", false);
}

/**
 * Set the mute state for all video or audio tracks
 * @param {string} type 'audio' or 'video'
 * @param {boolean} mute_state true for mute, false for unmute
 */
function set_mute_all(type, mute_state) {
  my_media_stream.getTracks().forEach(function (stream) {
    // console.log("looping");
    // console.log(stream);
    if (stream.kind == type) {
      stream.enabled = !mute_state;
    }
  });
}

//
// PlayAudio File in Browser
//
const pre_sound = "play_sound_id_";
function playAudio(name, url) {
  var sound_el = document.createElement("audio");
  // sound.id = ;
  sound_el.autoplay = true;
  sound_el.id = pre_sound + name;
  sound_el.loop = true;
  sound_el.src = url;
  if (mediaDiv) {
    document.getElementById(mediaDiv).appendChild(sound_el);
  } else {
    document.body.appendChild(sosound_elund);
  }
}
function stopAudio(name) {
  sound_el = document.getElementById(pre_sound + name);
  if (sound_el) {
    // make sure the sound stops right away
    sound_el.muted = true;
    sound_el.remove();
  }
}
