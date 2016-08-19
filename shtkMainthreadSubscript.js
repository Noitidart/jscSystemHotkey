/*global Services, callInMainworker */
/* if you dont have these global its ok they will be brought in: ostypes, ctypes, cutils */

// start - mainthread side for system hotkey
var gHotkeysRegisteredMt = false;
var gHotkeyMacCallbackMt_c = null;
var gHotkeyRefs = null; // object holding stuff needed for `hotkeysUnregisterMt`
function hotkeysRegisterMt(aArg) {
	var deferredmain = new Deferred();

	var __ERROR; // if error, an object {hotkeyid, reason}
	var __REGISTREDs = {};

	if (gHotkeysRegisteredMt) {
		console.warn('hotkeys already registred on mainthread');
		deferredmain.resolve({
			// hotkeyid: none associated
			reason: 'Hotkeys already registered'
		});
		return deferredmain.promise;
	}

	initOstypes();

	switch (Services.appinfo.OS.toLowerCase()) {
		case 'darwin':

				var { hotkeys_basic } = aArg; // just some basic info of the hotkeys, not the actual hotkeys list

				var eventType = ostypes.TYPE.EventTypeSpec();
				eventType.eventClass = ostypes.CONST.kEventClassKeyboard;
				eventType.eventKind = ostypes.CONST.kEventHotKeyPressed;

				gHotkeyMacCallbackMt_c = ostypes.TYPE.EventHandlerUPP(hotkeyMacCallbackMt);

				var rez_appTarget = ostypes.API('GetApplicationEventTarget')();
				// console.log('rez_appTarget GetApplicationEventTarget:', rez_appTarget.toString());

				var install_ref = ostypes.TYPE.EventHandlerRef();
				var rez_install = ostypes.API('InstallEventHandler')(rez_appTarget, gHotkeyMacCallbackMt_c, 1, eventType.address(), null, install_ref.address())
				if (!cutils.jscEqual(rez_install, ostypes.CONST.noErr)) {
					__ERROR = {
						// hotkeyid: 'all', // really is all, but just leave it undefined
						reason: 'Failed to install hotkey event handler for OSStatus of "' + cutils.jscGetDeepest(rez_install) + '" / "' + ostypes.HELPER.convertLongOSStatus(cutils.jscGetDeepest(rez_install)) + '"'
					};
				} else {
					gHotkeyRefs = {};
					gHotkeyRefs.install = install_ref;
					// gHotkeyInstallRef = cutils.strOfPtr(install_ref);
					for (var hotkey_basic of hotkeys_basic) {
						var { signature, hotkeyid, code_os, mods_os } = hotkey_basic;

						var ref = ostypes.TYPE.EventHotKeyRef();
						var inHotKeyID = ostypes.TYPE.EventHotKeyID();
						inHotKeyID.signature = signature; // has to be a four char code. MACS is http://stackoverflow.com/a/27913951/1828637 0x4d414353 so i just used htk1 as in the example here http://dbachrach.com/blog/2005/11/program-global-hotkeys-in-cocoa-easily/ i just stuck into python what the stackoverflow topic told me and got it struct.unpack(">L", "htk1")[0]
						inHotKeyID.id = hotkeyid;

						var rez_reg = ostypes.API('RegisterEventHotKey')(code_os, mods_os, inHotKeyID, rez_appTarget, 0, ref.address());
						console.log('rez_reg:', rez_reg.toString(), ostypes.HELPER.convertLongOSStatus(rez_reg));

						if (cutils.jscEqual(rez_reg, ostypes.CONST.noErr)) {
							// gHotkeyRefs.push(ref);
							gHotkeyRefs[hotkeyid] = ref;
							__REGISTREDs[hotkeyid] = {
								// ref: cutils.strOfPtr(ref),
								hotkeyid,
								signature, // not really used, but ill store it, for the heck of it
								last_triggered: 0
							};
						} else {
							__ERROR = {
								hotkeyid,
								reason: 'Failed to register hotkey for OSStatus of "' + cutils.jscGetDeepest(rez_reg) + '" / "' + ostypes.HELPER.convertLongOSStatus(cutils.jscGetDeepest(rez_reg)) + '"'
							};
							break;
						}
					}

					if (Object.keys(__REGISTREDs).length) {
						// even if __ERROR happened, we want to mark this as true, as when i resolve this, the worker will calll hotkeysUnregisterMt, which wont commence unless something is registred. and in reality yes thigns are registered, just not all registred
						gHotkeysRegisteredMt = true;
					}
				}
			break;
		default:
			throw new Error('your os is not supported for mainthread side system hotkey');
	}

	deferredmain.resolve({
		__ERROR,
		__REGISTREDs
	})
	return deferredmain.promise;
}
function hotkeysUnregisterMt(aArg) {
	if (!gHotkeysRegisteredMt) {
		console.error('hotkeys not yet registred (meaning inited) on mainthread')
		// throw new Error('hotkeys not yet registred (meaning inited) on mainthread')
		return {
			reason: 'Hotkey main thread registration was not done'
		};
	}

	switch (Services.appinfo.OS.toLowerCase()) {
		case 'darwin':

				var { hotkeys } = aArg;

				for (var hotkey of hotkeys) {
					var { __REGISTERED } = hotkey;
					if (__REGISTERED) {
						// var { ref } = __REGISTERED;
						var { hotkeyid } = __REGISTERED;
						// ref = ostypes.TYPE.EventHotKeyRef(ctypes.UInt64(ref));
						var rez_unreg = ostypes.API('UnregisterEventHotKey')(gHotkeyRefs[hotkeyid]);
						console.log('rez_unreg:', rez_unreg, rez_unreg.toString());
						// TODO: maybe some error handling, i dont do yet for windows or nix so i dont do here for now either
					}
				}

				// var install_ref = ostypes.TYPE.EventHandlerRef(ctypes.UInt64(gHotkeyInstallRef));
				var rez_uninstall = ostypes.API('RemoveEventHandler')(gHotkeyRefs.install);
				console.log('rez_uninstall:', rez_uninstall, rez_uninstall.toString());

				gHotkeyRefs = null;
				gHotkeyMacCallbackMt_c = null;
				gHotkeyInstallRef = null;
				gHotkeysRegisteredMt = false;

			break;
		default:
			throw new Error('your os is not supported for mainthread side system hotkey');
	}
}
function hotkeyMacCallbackMt(nextHandler, theEvent, userDataPtr) {
	// EventHandlerCallRef nextHandler, EventRef theEvent, void *userData
	console.log('wooohoo ah!! called hotkey!');

	var now_triggered = Date.now();

	var hkcom = ostypes.TYPE.EventHotKeyID();
    var rez_getparam = ostypes.API('GetEventParameter')(theEvent, ostypes.CONST.kEventParamDirectObject, ostypes.CONST.typeEventHotKeyID, null, hkcom.constructor.size, null, hkcom.address());
	console.log('rez_getparam:', rez_getparam, rez_getparam.toString());
    var id = parseInt(cutils.jscGetDeepest(hkcom.id));

	callInMainworker('hotkeyMacCallback', {
		id,
		now_triggered
	});

	return 0; // must be of type ostypes.TYPE.OSStatus
}
// end - mainthread side for system hotkey

if (typeof(ostypes) == 'undefined') {
	var ostypes;
}
if (typeof(initOstypes) == 'undefined') {
	function initOstypes() {
		if (!ostypes) {
			if (typeof(ctypes) == 'undefined') {
				Cu.import('resource://gre/modules/ctypes.jsm');
			}

			Services.scriptloader.loadSubScript(PATH_SCRIPTS + 'ostypes/cutils.jsm'); // need to load cutils first as ostypes_mac uses it for HollowStructure
			Services.scriptloader.loadSubScript(PATH_SCRIPTS + 'ostypes/ctypes_math.jsm');
			switch (Services.appinfo.OS.toLowerCase()) {
				case 'winnt':
				case 'winmo':
				case 'wince':
						Services.scriptloader.loadSubScript(PATH_SCRIPTS + 'ostypes/ostypes_win.jsm');
					break;
				case 'darwin':
						Services.scriptloader.loadSubScript(PATH_SCRIPTS + 'ostypes/ostypes_mac.jsm');
					break;
				default:
					// assume xcb (*nix/bsd)
					Services.scriptloader.loadSubScript(PATH_SCRIPTS + 'ostypes/ostypes_x11.jsm');
			}
		}
	}
}
