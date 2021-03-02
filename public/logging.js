//
// LOGGING / STATUS UPDATES
//
const DEBUG = true;
// a div to update with status messages re: progress of getting online
const statusDiv = null;
// a div to append log messages to on screen
const logDiv = false;

function setStatusDiv(status_div_id) {
  if (!statusDiv) {
    statusDiv = status_div_id;
  }
}
/**
 * set a the innerHTML of a div to the status,
 *  expects statusDiv to be set
 * @param {*} status
 */
function updateStatus(status) {
  if (!statusDiv) {
    console.log(`Status update: ${status}`);
  } else {
    document.getElementById(statusDiv).innerHTML = status;
  }
}

//
// This gets the debug info into a div on the screen
// helpful for debugging mobile clients
if (DEBUG) {
  if (typeof console != "undefined") {
    if (typeof console.log != "undefined") {
      console.orig_log = console.log;
    } else console.orig_log = function () {};
  }

  console.log = function (message) {
    console.orig_log(message);
    if (logDiv) {
      document.getElementById(logDiv).append(">" + message);
      document.getElementById(logDiv).append(document.createElement("br"));
    }
  };
  console.error = console.debug = console.info = console.log;
}
