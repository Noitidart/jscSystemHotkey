// Globals

// Imports
const PATH = JSON.parse(xhrSync('../shtkPaths.json').response);
var TOOLKIT; // populated by `init`
var OS_NAME = OS.Constants.Sys.Name.toLowerCase();

var gHotkeysRegisteredPl;
var gHotkeysLoopRunningPl;

var gMacStuff = {
	runloop_ref: null,
	runloop_mode: null,

	tapEventCallback: null,
	_eventPort: null,
	_eventPortSource: null,

	hotkeys_basic: null
};

importScripts(PATH.comm + 'Comm.js');
var { callInMainworker } = CommHelper.childworker;

// import ostypes
importScripts(PATH.ostypes + 'cutils.jsm');
importScripts(PATH.ostypes + 'ctypes_math.jsm');

switch (OS.Constants.Sys.Name.toLowerCase()) {
  case 'winnt':
  case 'winmo':
  case 'wince':
		  importScripts(PATH.ostypes + 'ostypes_win.jsm');
	  break;
  case 'darwin':
		  importScripts(PATH.ostypes + 'ostypes_mac.jsm');
	  break;
  default:
	  // we assume it is a GTK based system. All Linux/Unix systems are GTK for Firefox. Even on Qt based *nix systems.
	  importScripts(PATH.ostypes + 'ostypes_x11.jsm');
}

// Setup communication layer with mainworker
var gWkComm = new Comm.client.worker();

// not needed, because the onBeforeTerminate of the shtkMainworkerSubscript will already call this
// function onBeforeTerminate() {
//   var promiseall_arr = [];
//   promiseall_arr.push(hotkeysUnregisterPl()); // on mac its a promise, on others its not, but `Promise.all` works fine with non-promise entries in its array
//   // any other things you want to do before terminate, push it to promiseall_arr
//   return Promise.all(promiseall_arr);
// }

function init(aArg) {
	var { GTK_VERSION } = aArg;

	if (GTK_VERSION) {
		TOOLKIT = 'gtk' + GTK_VERSION; // for ostypes
	}

	var rez;
	switch (OS_NAME) {
		case 'darwin':
				gMacStuff.runloop_ref = ostypes.API('CFRunLoopGetCurrent')();
				gMacStuff.runloop_mode = ostypes.HELPER.makeCFStr('com.mozilla.firefox.shtk' + nonceLowerText(8));

				rez = {
					runloop_ref_strofptr: cutils.strOfPtr(gMacStuff.runloop_ref) // so MainWorker can interrupt/stop the infinite loop
				};
			break;
	}

	return rez;
}

function hotkeysRegisterPl(aArg) {
	var { hotkeys_basic } = aArg;

	if (gHotkeysRegisteredPl) {
		console.warn('hotkeys already registerd in poller');
		return;
	}

	var __ERROR; // if error, an object {hotkeyid, reason}
	var __REGISTREDs = {};

	switch (OS_NAME) {
		case 'darwin':

				hotkeys_basic = hotkeys_basic.filter( el => el.mac_method == 'corefoundation' );
				gMacStuff.hotkeys_basic = hotkeys_basic;

				var tapEventCallback_js = function(proxy, type, event, refcon) {

					if (cutils.jscEqual(type, ostypes.CONST.kCGEventTapDisabledByTimeout)) {
						console.log('RENABLING!!!!');
						ostypes.API('CGEventTapEnable')(gMacStuff._eventPort, true);
						return event;
					} else if (cutils.jscEqual(type, ostypes.CONST.kCGEventTapDisabledByUserInput)) {
						// Was disabled manually by -[pauseTapOnTapThread]
						console.error('this should never happen!!!! but return event so things work as my tap is non-passive');
						return event;
					}

					if (!cutils.jscEqual(type, ostypes.CONST.NX_SYSDEFINED)) {
						return event;
					} else {
						var NSEvent = ostypes.HELPER.class('NSEvent');
						var nsEvent = ostypes.API('objc_msgSend')(NSEvent, ostypes.HELPER.sel('eventWithCGEvent:'), event);

						var subtype = ostypes.API('objc_msgSend')(nsEvent, ostypes.HELPER.sel('subtype'));
						console.log('subtype:', subtype);
						subtype = cutils.jscGetDeepest(ctypes.cast(subtype, ostypes.TYPE.NSUInteger));
						console.log('casted subtype:', subtype);

						if (!cutils.jscEqual(subtype, 8)) {
							return event;
						} else {
							var data1 = ostypes.API('objc_msgSend')(nsEvent, ostypes.HELPER.sel('data1'));
							console.log('data1:', data1);
							data1 = cutils.jscGetDeepest(ctypes.cast(data1, ostypes.TYPE.NSUInteger));
							console.log('casted data1:', data1);

							var keyCode = data1 >>> 16;
							var keyRepeat = data1 & 0x1;
							var keyFlags = data1 & 0x0000FFFF;
							var keyState = (((keyFlags & 0xFF00) >> 8)) == 0xA; // "I’m not completely sure on the “keyState” code, it appears the value alternates between 0xA and 0xB depending on if the key is up or down. There may be other values I don’t know about though." - http://weblog.rogueamoeba.com/2007/09/29/

							var modsc = {
								meta: false,
								shift: false,
								alt: false,
								control: false,
								fn: false,
								capslock: false
							};

							// maybe should get keyFlags with `NSUInteger theFlags = [NSEvent modifierFlags];` ?
							if (keyFlags & ostypes.CONST.NSCommandKeyMask)		{ modsc.meta = true }
						    if (keyFlags & ostypes.CONST.NSShiftKeyMask)		{ modsc.shift = true }
						    if (keyFlags & ostypes.CONST.NSAlternateKeyMask)	{ modsc.alt = true }
						    if (keyFlags & ostypes.CONST.NSControlKeyMask)		{ modsc.control = true }
						    if (keyFlags & ostypes.CONST.NSFunctionKeyMask)		{ modsc.fn = true }
							if (keyFlags & ostypes.CONST.NSAlphaShiftKeyMask)	{ modsc.capslock = true }

							var now_triggered = Date.now();

							for (var hotkey_basic of gMacStuff.hotkeys_basic) {
								var { code_os, hotkeyid, mods } = hotkey_basic;
								if (cutils.jscEqual(code_os, keyCode)) {
									console.log('current mods:', modsc, 'hotkey->mods:', mods);
									// make sure modifiers match
									if (mods) {
										for (var modname in modsc) {
											if (modsc[modname] != mods[modname]) {
												console.warn('keyCode matched, however the modifiers dont match. first offending modifier:', modname)
												return event; // dont block the event
											}
										}
									}
									callInMainworker('hotkeyMacCallback', {
										hotkeyid,
										now_triggered
									});

									return null; // block the event, so like it doesnt interfere with iTunes
								}
							}

							return event;

							// if consume with return null should i do a [nsEvent retain]? as they do here - https://github.com/nevyn/SPMediaKeyTap/blob/master/SPMediaKeyTap.m#L228
						}
					}

					return event;
				};
				gMacStuff.tapEventCallback = ostypes.TYPE.CGEventTapCallBack(tapEventCallback_js);

				// Add an event tap to intercept the system defined media key events
				gMacStuff._eventPort = ostypes.API('CGEventTapCreate')(
					ostypes.CONST.kCGSessionEventTap,
					ostypes.CONST.kCGHeadInsertEventTap,
					ostypes.CONST.kCGEventTapOptionDefault,
					ostypes.API('CGEventMaskBit')(ostypes.CONST.NX_SYSDEFINED),
					gMacStuff.tapEventCallback,
					null
				);
				console.log('gMacStuff._eventPort:', gMacStuff._eventPort);
				if (gMacStuff._eventPort.isNull()) {
					__ERROR = {
						// hotkeyid: none associated
						reason: 'Failed to get _getPort as it is null!'
					};
					return { __ERROR, __REGISTREDs };
				}

				gMacStuff._eventPortSource = ostypes.API('CFMachPortCreateRunLoopSource')(ostypes.CONST.kCFAllocatorSystemDefault, gMacStuff._eventPort, 0);
				console.log('gMacStuff._eventPortSource:', gMacStuff._eventPortSource);
				if (gMacStuff._eventPortSource.isNull()) {
					console.error('ERROR: Failed to get _eventPortSource as it is null!');
					gMacStuff._eventPortSource = null;
					ostypes.API('CFRelease')(gMacStuff._eventPort);
					__ERROR = {
						// hotkeyid: none associated
						reason: 'Failed to get _eventPortSource as it is null!'
					};
					return { __ERROR, __REGISTREDs };
				}

				ostypes.API('CFRunLoopAddSource')(gMacStuff.runloop_ref, gMacStuff._eventPortSource, gMacStuff.runloop_mode);
				console.log('did CFRunLoopAddSource');

				gHotkeysRegisteredPl = true;

				// mark all as registered
				for (var hotkey_basic of hotkeys_basic) {
					var { hotkeyid, code_os, mods_os } = hotkey_basic;

					__REGISTREDs[hotkeyid] = {
						last_triggered: 0
					};
				}

				setTimeout(hotkeysStartLoopPl, 0);
				return { __ERROR, __REGISTREDs };

			break;
		default:
			console.error('your os not supported for hotkeysRegisterPl!');
			throw new Error('your os not supported for hotkeysRegisterPl!');
	}

}

function hotkeysUnregisterPl(aArg) {
	// aArg is passed as `null`

	if (!gHotkeysRegisteredPl) {
		console.warn('hotkeys already UNregisterd in poller');
		return;
	}

	switch (OS_NAME) {
		case 'darwin':


				ostypes.API('CFRunLoopSourceInvalidate')(gMacStuff._eventPortSource);
				console.log('invalidated _eventPortSource');
				ostypes.API('CFRelease')(gMacStuff._eventPortSource);
				console.log('released _eventPortSource');
				gMacStuff._eventPortSource = null;

				ostypes.API('CFRelease')(gMacStuff._eventPort);
				console.log('released _eventPort');
				gMacStuff._eventPort = null;

				console.log('released tapEventCallback');
				gMacStuff.tapEventCallback = null;

				gMacStuff.hotkeys_basic = null;

				gHotkeysRegisteredPl = false;

			break;
		default:
			console.error('your os not supported for hotkeysUnregisterPl!');
			throw new Error('your os not supported for hotkeysUnregisterPl!');
	}
}

function hotkeysStartLoopPl() {
	if (gHotkeysLoopRunningPl) {
		// never stopped loop
		return;
	}

	gHotkeysLoopRunningPl = true;
	hotkeysLoopPl();
}

function hotkeysStopLoopPl() {
	if (!gHotkeysLoopRunningPl) {
		// never started loop
		return;
	}
	gHotkeysLoopRunningPl = false;
}

function hotkeysLoopPl() {
	switch (OS_NAME) {
		case 'darwin':

				while (true) {
					var rez_run = ostypes.API('CFRunLoopRunInMode')(gMacStuff.runloop_mode, 100000, false); // 2nd arg is seconds
					console.log('rez_run:', rez_run);

					if (cutils.jscEqual(rez_run, ostypes.CONST.kCFRunLoopRunStopped)) { // because when i stop it from MainWorker I use this constant
						hotkeysStopLoopPl();
						break; // end the infinite loop
					}
				}

			break;
		default:
			console.error('your os not supported for hotkeysLoopPl!');
			throw new Error('your os not supported for hotkeysLoopPl!');
	}
}

function xhrSync(aUrlOrFileUri, aOptions={}) {
	var default_options = {
		method: 'GET',
		data: undefined
	};
	var options = Object.assign({}, default_options, aOptions);

	var request = new XMLHttpRequest();

	request.open(options.method, aUrlOrFileUri, false); // 3rd arg is false for synchronus

	request.send(aOptions.data);

	return request;
}

function nonceLowerText(length) {
	// generates a nonce
	var text = '';
	var possible = 'abcdefghijklmnopqrstuvwxyz';
	for(var i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
