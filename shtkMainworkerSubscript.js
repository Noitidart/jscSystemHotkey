/* global OS ostypes callInBootstrap gHKI ctypes cutils */
	// these must be defined
	// how on earth can ostypes NOT be defined? they had to use it to set `code` in gHKI

var gHKIOsName = OS.Constants.Sys.Name.toLowerCase();
var gHKILoopInterval = null;

function hotkeysRegister() {
	// on error, it returns an object:
	 	// hotkey - `hotkey` entry in gHKI.hotkeys that caused the failure
		// reason - string explaining why
	var deferredmain = new Deferred();

	if (!('next_hotkey_id' in gHKI)) {
		gHKI.next_hotkey_id = 1;
	}

	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				var hotkeys = gHKI.hotkeys;
				for (var hotkey of hotkeys) {
					var { __REGISTERED, mods, code:code_os } = hotkey;

					if (__REGISTERED) {
						console.warn('hotkey already registered for entry:', hotkey);
						continue;
					} else {
						var mods_os = hotkeysModsToModsos(mods);
						var hotkeyid = gHKI.next_hotkey_id++;
						var rez_reg = ostypes.API('RegisterHotKey')(null, hotkeyid, mods_os, code_os);
						if (rez_reg) {
							hotkey.__REGISTERED = {
								hotkeyid,
								last_triggered: 0 // Date.now() of when it was last triggered, for use to check with min_time_between_repeat
							};
						} else {
							console.error('failed to register hotkey:', hotkey);
							console.error('due to fail will not register any of the other hotkeys if there were any, and will unregister whatever was registered');
							hotkeysUnregister();
							deferredmain.resolve({
								hotkey,
								reason: 'Failed for winLastError of "' + ctypes.winLastError + '"'
							});
							return deferredmain.promise;
						}
					}
				}

				hotkeysStartLoop();

				deferredmain.resolve(null); // resolve with `null` for no error

			break;
		case 'darwin':

				var hotkeys_basic = [];
				var { hotkeys } = gHKI;

				for (var hotkey of hotkeys) {
					var { code:code_os, mods } = hotkey;

					var mods_os = hotkeysModsToModsos(mods);

					var hotkeyid = gHKI.next_hotkey_id++;
					var signature = ostypes.HELPER.OS_TYPE(nonce(4 - hotkeyid.toString().length) + hotkeyid.toString());

					hotkey.temp_hotkeyid = hotkeyid; // this is premetive, so on return of `hotkeysRegisterMt`, i can go in and find the corresponding `hotkey` entry to attach the returned `ref`/`__REGISTERED`

					hotkeys_basic.push({
						mods_os,
						code_os,
						signature,
						hotkeyid
					});
				}

				callInBootstrap('hotkeysRegisterMt', { hotkeys_basic }, function(aObjOfErrAndRegs) {
					var { __ERROR, __REGISTREDs } = aObjOfErrAndRegs;

					var errored_hotkey;
					if (__ERROR && __ERROR.hotkeyid) {
						// find the `hotkey` entry associated with it, as in next block i will delete all hotkey.temp_hotkeyid
						errored_hotkey = hotkeys.find( el => el.temp_hotkeyid === __ERROR.hotkeyid );
					}

					if (Object.keys(__REGISTREDs).length) {
						// if any were succesfully registered, then go through add the `__REGISTERED` object to the associated `hotkey` entry. find association by `hotkey.temp_hotkeyid`
						for (var hotkey of hotkeys) {
							var { temp_hotkeyid:hotkeyid } = hotkey;

							delete hotkey.temp_hotkeyid;

							if (__REGISTREDs[hotkeyid]) {
								hotkey.__REGISTERED = __REGISTREDs[hotkeyid];
							}
						}

						if (__ERROR) {
							hotkeysUnregister();
						}
					}

					if (__ERROR) {
						deferredmain.resolve({
							hotkey: errored_hotkey,
							reason: __ERROR.reason
						});
					}
				});

			break;
		default:
			// assume (*nix/bsd)

			var hotkeys = gHKI.hotkeys;

			// // get `code_os` for each `code`

			// collect unique codes
			var codes = new Set();
			for (var hotkey of hotkeys) {
				codes.add(hotkey.code);
			}

			codes = [...codes];

			var code_os_to_codes_os = {};

			var keysyms = ostypes.API('xcb_key_symbols_alloc')(ostypes.HELPER.cachedXCBConn());
			console.log('keysyms:', keysyms.toString());

			for (var code of codes) {
				code_os_to_codes_os[code] = []; // array becuase multiple codeos can exist for a single code


				var keycodesPtr = ostypes.API('xcb_key_symbols_get_keycode')(keysyms, code);
				console.log('keycodesPtr:', keycodesPtr.toString());

				for (var i=0; i<10; i++) { // im just thinking 10 is a lot, usually you only have 1 keycode. mayyybe 2. 10 should cover it
					var keycodesArrC = ctypes.cast(keycodesPtr, ostypes.TYPE.xcb_keycode_t.array(i+1).ptr).contents;
					console.log('keycodesArrC:', keycodesArrC);
					if (cutils.jscEqual(keycodesArrC[i], ostypes.CONST.XCB_NO_SYMBOL)) {
						break;
					} else {
						code_os_to_codes_os[code].push(keycodesArrC[i]);
					}
				}

				ostypes.API('free')(keycodesPtr);

				if (!code_os_to_codes_os[code].length) {
					console.error('linux no keycodes found for hotkey code:', code);
					// throw new Error('linux no keycodes found for hotkey code: ' + code);
					// nothing yet registered, so no need to run `hotkeysUnregister()`
					deferredmain.resolve({
						hotkey: hotkeys.find(el => el.code === code),
						reason: 'No keycodes on this system for code of "' + code+ '"'
					}); // the first hoeky that uses this `code`
					return deferredmain.promise;
				}
			}

			ostypes.API('xcb_key_symbols_free')(keysyms);

			// // grab the keys
			// collect the grab windows
			var setup = ostypes.API('xcb_get_setup')(ostypes.HELPER.cachedXCBConn());
			console.log('setup:', setup.contents);

			var screens = ostypes.API('xcb_setup_roots_iterator')(setup);
			var grabwins = []; // so iterate through these and ungrab on remove of hotkey
			var screens_cnt = screens.rem;

			for (var i=0; i<screens_cnt; i++) {
				// console.log('screen[' + i + ']:', screens);
				console.log('screen[' + i + '].data:', screens.data.contents);
				var grabwin = screens.data.contents.root;
				grabwins.push(grabwin);
				ostypes.API('xcb_screen_next')(screens.address());
			}

			// start registering hotkeys if they are not registered
			for (var hotkey of hotkeys) {
				var { code, mods, __REGISTERED } = hotkey;
				if (__REGISTERED) {
					console.warn('hotkey already registered for entry:', hotkey);
					continue;
				} else {

					var mods_os = hotkeysModsToModsos(mods);

					var codes_os = code_os_to_codes_os[code];

					// grab this hotkey on all grabwins
					// var any_win_registered = false;
					// var any_codeos_registered = false;
					// var any_registered = false;
					for (var grabwin of grabwins) {
						for (var code_os of codes_os) {
							var rez_grab = ostypes.API('xcb_grab_key_checked')(ostypes.HELPER.cachedXCBConn(), 1, grabwin, mods_os, code_os, ostypes.CONST.XCB_GRAB_MODE_ASYNC, ostypes.CONST.XCB_GRAB_MODE_ASYNC);
							var rez_check = ostypes.API('xcb_request_check')(ostypes.HELPER.cachedXCBConn(), rez_grab);
							console.log('rez_check:', rez_check.toString());
							if (!rez_check.isNull()) {
								console.error('The hotkey is already in use by another application. Find that app, and make it release this hotkey. Possibly could be in use by the "Global Keyboard Shortcuts" of the system.'); // http://i.imgur.com/cLz1fDs.png
							} else {
								// even if just one registered, lets mark it registerd, so the `hotkeysUnregister` function will just get errors on what isnt yet registered from the set of `code_os_to_codes_os`
								// any_registered = true;
								hotkey.__REGISTERED = {
									grabwins,
									codes_os,
									last_triggered: 0
								};
							}
						}
					}

					if (!hotkey.__REGISTERED) { // same as checking `if (!any_registered)`
						// nothing for any of the codeos's for this code registered on any of the grabwins
						console.error('failed to register hotkey:', hotkey);
						console.error('due to fail will not register any of the other hotkeys if there were any, and will unregister whatever was registered');
						hotkeysUnregister();
						deferredmain.resolve({
							hotkey,
							reason: 'It is most likely that this key combination is already in use by another application. Find that app, and make it release this hotkey. Possibly could be in use by the "Global Keyboard Shortcuts" of the system - http://i.imgur.com/cLz1fDs.png\n\n\nDetails: Was not able to register any of the `code_os` on any of the `grabwins`. `grabwins`: ' + grabwins.toString() + ' code_os: ' + code_os.toString()
						});
						return deferredmain.promise;
					}

				}
			}

			var rez_flush = ostypes.API('xcb_flush')(ostypes.HELPER.cachedXCBConn());
			console.log('rez_flush:', rez_flush);

			hotkeysStartLoop();

		deferredmain.resolve(null); // resolve with `null` for no error
	}

	return deferredmain.promise;
}

function hotkeysUnregister() {

	hotkeysStopLoop();

	var hotkeys = gHKI.hotkeys;
	if (!hotkeys) { return } // never ever registered

	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				for (var hotkey of hotkeys) {
					var { __REGISTERED, mods, code:code_os } = hotkey;

					if (!__REGISTERED) {
						console.warn('this one is not registered:', hotkey);
					} else {
						var { hotkeyid } = __REGISTERED;
						var rez_unreg = ostypes.API('UnregisterHotKey')(null, hotkeyid);
						if (!rez_unreg) {
							console.error('failed to unregister hotkey:', hotkey);
						} else {
							delete hotkey.__REGISTERED;
						}
					}
				}

			break;
		case 'darwin':

				var deferredmain = new Deferred();
				callInBootstrap('hotkeysUnregisterMt', { hotkeys }, function() {
					for (var hotkey of hotkeys) {
						delete hotkey.__REGISTERED;
					}
					deferredmain.resolve()
				});

				return deferredmain.promise;

			break;
		default:
			// assume xcb(*nix/bsd)
			for (var hotkey of hotkeys) {
				var { __REGISTERED, mods, code:code_os } = hotkey;

				if (!__REGISTERED) {
					console.warn('this one is not registered:', hotkey);
				} else {
					var { codes_os, grabwins } = __REGISTERED;

					var mods_os = hotkeysModsToModsos(mods);
					for (var grabwin of grabwins) {
						for (var code_os of codes_os) {
							var rez_ungrab = ostypes.API('xcb_ungrab_key')(ostypes.HELPER.cachedXCBConn(), code_os, grabwin, mods_os);
							console.log('rez_ungrab:', rez_ungrab);
						}
					}

					// TODO: maybe add error checking if ungrab fails, not sure
					delete hotkey.__REGISTERED;
				}
			}

			var rez_flush = ostypes.API('xcb_flush')(ostypes.HELPER.cachedXCBConn());
			console.log('rez_flush:', rez_flush);
	}

	console.log('succesfully unregistered hotkeys');
}

function hotkeysStartLoop() {
	if (gHKILoopInterval !== null) {
		// never stopped loop
		return;
	}

	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				gHKI.win_msg = ostypes.TYPE.MSG();

			break;
	}

	gHKILoopInterval = setInterval(hotkeysLoop, gHKI.loop_interval_ms);
}

function hotkeysStopLoop() {
	if (gHKILoopInterval === null) {
		// never started loop
		return;
	}

	clearInterval(gHKILoopInterval);
	gHKILoopInterval = null;

	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				delete gHKI.win_msg;

			break;
	}

}

function hotkeysLoop() {
	// event loop for hotkey
	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				var msg = gHKI.win_msg;
				var hotkeys = gHKI.hotkeys;
				while (ostypes.API('PeekMessage')(msg.address(), null, ostypes.CONST.WM_HOTKEY, ostypes.CONST.WM_HOTKEY, ostypes.CONST.PM_REMOVE)) {
					// console.log('in peek, msg:', msg);
					for (var hotkey of hotkeys) {
						var { callback, __REGISTERED } = hotkey;
						if (__REGISTERED) {
							var { last_triggered, hotkeyid } = __REGISTERED;
							if (cutils.jscEqual(hotkeyid, msg.wParam)) {
								var now_triggered = Date.now();
								if ((now_triggered - last_triggered) > gHKI.min_time_between_repeat) {
									__REGISTERED.last_triggered = now_triggered;
									gHKI.callbacks[callback]();
								}
								else { console.warn('time past is not yet greater than min_time_between_repeat, time past:', (now_triggered - last_triggered), 'ms'); }
								__REGISTERED.last_triggered = now_triggered; // dont allow till user keys up for at least min_time_between_repeat
							}
						}
					}
				}

			break;
		case 'darwin':

				throw new Error('darwin not supported for fake loop - use real loop');

			break;
		default:
			// assume xcb (*nix/bsd)
			while (true) {
				// true until evt is found to be null
				var evt = ostypes.API('xcb_poll_for_event')(ostypes.HELPER.cachedXCBConn());
				if (!evt.isNull()) {
					if (evt.contents.response_type == ostypes.CONST.XCB_KEY_PRESS) {
						var hotkeys = gHKI.hotkeys;
						hotkeyOf:
						for (var hotkey of hotkeys) {
							var { callback, __REGISTERED } = hotkey;
							if (__REGISTERED) {
								var { codes_os, last_triggered } = __REGISTERED;
								for (var code_os of codes_os) {
									if (cutils.jscEqual(code_os, evt.contents.pad0)) {
										var now_triggered = Date.now();
										if ((now_triggered - last_triggered) > gHKI.min_time_between_repeat) {
											console.warn('TRIGGERING!!!!!! time past IS > min_time_between_repeat, time past:', (now_triggered - last_triggered), 'ms, gHKI.min_time_between_repeat:', gHKI.min_time_between_repeat, 'last_triggered:', last_triggered);
											__REGISTERED.last_triggered = now_triggered;
											gHKI.callbacks[callback]();
											break hotkeyOf;
										}
										else { console.warn('time past is not yet greater than min_time_between_repeat, time past:', (now_triggered - last_triggered), 'ms, gHKI.min_time_between_repeat:', gHKI.min_time_between_repeat, 'last_triggered:', last_triggered); }
										__REGISTERED.last_triggered = now_triggered; // dont allow till user keys up for at least min_time_between_repeat
										break hotkeyOf;
									}
								}
							}
						}
					}

					ostypes.API('free')(evt);
				} else {
					break;
				}
			}

	}
}

function hotkeyMacCallback(aArg) {
	var { id, now_triggered } = aArg;
	id = parseInt(id);

	var { hotkeys } = gHKI;

	for (var hotkey of hotkeys) {
		var { callback, __REGISTERED } = hotkey;
		if (__REGISTERED) {
			var { last_triggered, hotkeyid } = __REGISTERED;
			if (id === hotkeyid) {
				if ((now_triggered - last_triggered) > gHKI.min_time_between_repeat) {
					__REGISTERED.last_triggered = now_triggered;
					gHKI.callbacks[callback]();
				}
				else { console.warn('time past is not yet greater than min_time_between_repeat, time past:', (now_triggered - last_triggered), 'ms, last_triggered:', last_triggered); }
				__REGISTERED.last_triggered = now_triggered; // dont allow till user keys up for at least min_time_between_repeat
			}
		}
	}
}

function hotkeysModsToModsos(mods) {
	switch (gHKIOsName) {
		case 'winnt':
		case 'winmo':
		case 'wince':

				var mods_os = ostypes.CONST.MOD_NONE; // this is 0
				if (mods) {
					// possible mods: alt, control, shift, meta (meta means win key)
						// windows only mods: norepeat
					if (mods.alt) {
						mods_os |= ostypes.CONST.MOD_ALT;
					}
					if (mods.control) {
						mods_os |= ostypes.CONST.MOD_CONTROL;
					}
					if (mods.norepeat) {
						// not supported on win vista - per docs
						mods_os |= ostypes.CONST.MOD_NOREPEAT;
					}
					if (mods.shift) {
						mods_os |= ostypes.CONST.MOD_SHIFT;
					}
					if (mods.meta) {
						mods_os |= ostypes.CONST.MOD_WIN;
					}
				}

			break;
		case 'darwin':

				var mods_os = 0;
				if (mods) {
					// possible mods: alt (on mac alt and option key is same), control, shift, meta
						// mac only mods: capslock

					if (mods.capslock) {
						mods_os |= ostypes.CONST.alphaLock; // UNTESTED
					}
					if (mods.meta) {
						mods_os |= ostypes.CONST.cmdKey;
					}
					if (mods.alt) {
						mods_os |= ostypes.CONST.optionKey;
						// mods_os |= ostypes.CONST.rightOptionKey;
					}
					if (mods.shift) {
						mods_os |= ostypes.CONST.shiftKey;
						// mods_os |= ostypes.CONST.rightShiftKey;
					}
					if (mods.control) {
						mods_os |= ostypes.CONST.controlKey;
						// mods_os |= ostypes.CONST.rightControlKey;
					}
				}

			break;
		default:
			// assume xcb (*nix/bsd)
			var mods_os = ostypes.CONST.XCB_NONE; // is 0
			if (mods) {
				// possible mods: alt, control, shift, meta // TODO: <<< these are not yet supported
					// nix only mods: capslock, numlock - these are supported

				// XCB_MOD_MASK_*** to what - http://stackoverflow.com/questions/19376338/xcb-keyboard-button-masks-meaning#comment28827071_19376338
					// "Usually Mask1 is Alt or Meta, Mask2 is Num lock, Mask3 is AltGr, Mask4 is Win, and Mask5 is Scroll lock, but this varies between X implementations and/or keyboard models."
				if (mods.capslock) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_LOCK;
				}
				if (mods.numlock) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_2;
				}
				if (mods.shift) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_SHIFT;
				}
				if (mods.control) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_CONTROL;
				}
				if (mods.alt) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_1;
				}
				if (mods.meta) {
					mods_os |= ostypes.CONST.XCB_MOD_MASK_4;
				}
			}
	}

	return mods_os;
}
