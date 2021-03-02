// the name of the room we desire or are in
var room_name = false;
// the number of tiles (aka other videos)
var tile_count = 0;
// Force the videos to be smaller to show a share
var share_id = false;
// if we have made the share full screen
var full_screen_share = false;

// the select elements for devices
var cam_selector = "cam_selector";
var mic_selector = "mic_selector";

window.onload = async function () {
  // This ensures that we have WebRTC permissions
  //  - if you don't do this then your app will fail on first load
  //  and after they have accepted WebRTC permissions, they will have to reload the app
  //  - with this in place, it waits until perms are accepted and in place first
  checkWebRTC()
    .then(async function () {
      // then enumerate cameras
      cams = await getCameras();
      updateDeviceSelector(cam_selector, cams);
      mics = await getMics();
      updateDeviceSelector(mic_selector, mics);

      // then show default video device in our "vanity mirror"
      // not everything is ready right at load, so wait a bit
      setTimeout(function () {
        show_vanity_mirror(
          document.getElementById(cam_selector).value,
          "my_video"
        );
      }, 500);
    })
    .catch(async function (error) {
      alert(
        "Sorry, you'll need to provide WebRTC access to use this app. Please reload and accept permissions"
      );
      console.log(`Can't move forward without WebRTC Permissions`);
    });

  // Add listeners to our buttons
  joinButton = document.getElementById("join");
  joinButton.onclick = async function () {
    if (!room_name) {
      room_name = document.getElementById("room_name").value;
      if (!room_name || room_name == "") {
        room_name = "lobby";
      }
    }
    console.log(`Initialize app, for room ${room_name}`);
    document.getElementById("sign_on_controls").style.display = "none";

    let call_info = {
      caller: { name: document.getElementById("handle").value },
      call_type: "app",
      room: room_name,
      audio: true,
      video: true,
      video_device: document.getElementById(cam_selector).value,
      mic_device: document.getElementById(mic_selector).value,
    };
    await getOnline(call_info);
  };

  document.getElementById("sign_out").onclick = async function () {
    await signOff();
  };

  // update vanity mirror when cam selector is updated
  document.getElementById(cam_selector).onchange = async function () {
    await show_vanity_mirror(this.value, "my_video");
  };

  screenShareButton = document.getElementById("screen_share");
  screenShareButton.onclick = async function () {
    await screenShare().catch((err) =>
      console.log(`Screenshare error: ${err}`)
    );
  };

  // listen for clicks on dial out link
  dialOutLink = document.getElementById("dial_out");
  dialOutLink.onclick = async function () {
    let number = prompt("what number would you like to call?");
    let callee = prompt("what is their name?");
    await dialPSTN(number, callee).catch((err) =>
      console.log(`dial out error: ${err}`)
    );
  };

  // support for full screen
  shareScreen = document.getElementById("share");
  shareScreen.onclick = async function () {
    full_screen_share = !full_screen_share;
    updateVideoSizes();
  };

  // redo our tiles if they change the size of the window
  window.addEventListener("resize", updateVideoSizes);

  // check for a room_name on the query string
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("room")) {
    room_name = urlParams.get("room");
    document.getElementById("room_name").value = room_name;
  }
};

/**
 * Update our device lists, which current have a "default" option
 */
function updateDeviceSelector(selector_id, devices) {
  let selector = document.getElementById(selector_id);

  devices.forEach(function (device) {
    let opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.text = device.label.substring(0, 30);
    if (device.label.length > 30) opt.text += "...";

    selector.add(opt);
  });

  // if we had items in this list
  if (devices.length > 0) {
    // then remove the DEFAULT message
    selector.remove(0);

    // and add in a "no camera" option
    //  we'll look for a "none" option when going online
    var opt = document.createElement("option");
    opt.value = "none";
    opt.text = "disable";
    selector.add(opt);
  }
}

/**
 * This is fired off when this browser is online
 * @param {*} mediaEl
 * @param {*} rtcStream
 */
function isOnline(call_info, mediaStream) {
  document.getElementById("in_call_controls").style.display = "block";
}

/**
 * This is fired off when a new person joins the room
 * Custom function that you implement based on your UI and behavioral needs
 *
 * @param mediaEl the prebuilt media element, to add to our dom
 * @param rtcStream the actual stream
 */
async function onNewStream(mediaEl, rtcStream) {
  // create a block for the stream
  if (rtcStream.alias != "screenshare") {
    var newStream = document.createElement("div");
    newStream.id = "stream_" + rtcStream.endpointId;
    newStream.classList.add("tile");

    // we need this to contain the relative positioning
    var intermediary = document.createElement("div");
    intermediary.style.position = "relative";

    var nameTag = document.createElement("div");
    caller_name = rtcStream.alias;

    // lookup caller id if it's not passed in the alias
    if (caller_name == "__default__") {
      caller_name = await participantLookup(rtcStream.participantId);
    }
    nameTag.innerHTML = `${caller_name}`;
    nameTag.classList.add("namer");

    intermediary.appendChild(nameTag);
    intermediary.appendChild(mediaEl);

    // get it into the dom
    tile_count++;
    newStream.appendChild(intermediary);
    document.getElementById("videos").appendChild(newStream);
  } else {
    console.log("new stream to listen to");
    // this is a screenshare
    share_id = rtcStream.endpointId;

    var share_stream = document.createElement("div");
    share_stream.id = "stream_" + rtcStream.endpointId;
    share_stream.classList.add("share");
    share_stream.appendChild(mediaEl);
    document.getElementById("share").appendChild(share_stream);
    document.getElementById("share").style.display = "block";
  }

  updateVideoSizes();
}

/**
 * Clean up all the DOM elements for the participant that left
 * Custom function that you implement based on your UI and behavioral needs
 *
 * @param endPointId the id of endpoint that left
 */
function onEndStream(endPointId) {
  tile_count--;
  // if this ended sharing
  if (share_id == endPointId) {
    share_id = false;
  }
  tile = document.getElementById("stream_" + endPointId);
  if (tile) tile.remove();
  updateVideoSizes();
}

/**
 * Optional function called by webrtc_mgr.js when there are no other people left in the room
 */
function allCallsEnded() {
  disable_vanity_mirror();
  location.reload();
}

/**
 * Update the size of our video tiles based on the current count
 */
function updateVideoSizes() {
  // what does our grid look like
  rows = Math.round(Math.sqrt(tile_count));
  if (rows == 0) rows = 1;
  cols = Math.ceil(tile_count / rows);
  if (cols <= 0) cols = 1;

  // get the space do we have to work with
  const container = document.getElementById("videos");
  availableWidth = container.offsetWidth;
  availableHeight = container.offsetHeight;

  // update the screenshare if there is one
  if (share_id) {
    oldHeight = availableHeight;
    smallerScreen = 0.35;
    if (full_screen_share) {
      smallerScreen = 0.01;
    }
    availableHeight *= smallerScreen;

    shareEl = document.getElementById("share");
    shareEl.style.height = oldHeight - availableHeight;
    shareEl.style.width = availableWidth;
  }

  // tile height & width
  desired_height = availableHeight / rows - 5;
  max_tile_width = availableWidth / cols - 5;

  desired_width = desired_height * 1.777778;
  if (desired_width > max_tile_width) {
    desired_width = max_tile_width;
    desired_height = desired_width / 1.777778;
  }
  // console.log(`Vid size with: H: ${desired_height}, W: ${max_tile_width}`);

  // update all the tile videos
  const tiles = document.querySelectorAll(".tile");
  tiles.forEach(function (tile) {
    tile.style.height = desired_height;
    tile.style.width = desired_width;
  });
}
