/* global OS ostypes callInBootstrap gHKI ctypes cutils */
	// these must be defined
	// how on earth can ostypes NOT be defined? they had to use it to set `code` in gHKI

var gHKIOsName = OS.Constants.Sys.Name.toLowerCase();
var gHKILoopInterval = null;
var callInShtkPollWorker;
var gShtkPollComm;
var gShtkPollStuff = {};

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

				var reg_mt = false;
				var reg_poll = false;

				for (var hotkey of hotkeys) {
					var { code:code_os, mods, mac_method, __REGISTERED } = hotkey;

					if (!__REGISTERED) {
						var mods_os = hotkeysModsToModsos(mods);

						var hotkeyid = gHKI.next_hotkey_id++;
						var signature = mac_method == 'carbon' ? ostypes.HELPER.OS_TYPE(hotkeysNonce(4 - hotkeyid.toString().length) + hotkeyid.toString()) : undefined;

						hotkey.temp_hotkeyid = hotkeyid; // this is premetive, so on return of `hotkeysRegisterMt`, i can go in and find the corresponding `hotkey` entry to attach the returned `ref`/`__REGISTERED`

						hotkeys_basic.push({
							mods_os,
							mods,
							code_os,
							signature,
							hotkeyid,
							mac_method
						});

						if (mac_method == 'objc' || mac_method == 'carbon') {
							reg_mt = true;
						} else if (mac_method == 'corefoundation') {
							reg_poll = true;
						}
					}
				}

				var promiseallarr_reg = [];
				if (reg_mt) {
					var deferred_regmt = new Deferred();
					promiseallarr_reg.push(deferred_regmt.promise);
					callInBootstrap('hotkeysRegisterMt', { hotkeys_basic }, function(aObjOfErrAndRegs) {
						deferred_regmt.resolve(aObjOfErrAndRegs);
					});
				}
				if (reg_poll) {
					if (!callInShtkPollWorker) {
						callInShtkPollWorker = Comm.callInX.bind(null, 'gShtkPollComm', null);
					}
					if (!gShtkPollComm) {
						gShtkPollComm = new Comm.server.worker(gHKI.jscsystemhotkey_module_path + 'shtkPollWorker.js', ()=>({GTK_VERSION:(typeof(GTK_VERSION) != 'undefined' ? GTK_VERSION : null)}), aInitData=>gShtkPollStuff=aInitData );
					}

					var deferred_regpl = new Deferred();
					promiseallarr_reg.push(deferred_regpl.promise);
					callInShtkPollWorker('hotkeysRegisterPl', { hotkeys_basic }, function(aObjOfErrAndRegs) {
						deferred_regpl.resolve(aObjOfErrAndRegs);
					});
				}

				Promise.all(promiseallarr_reg).then(obj_failed_regs_arr => {
					var errored; // the first hotkey that errored
					// if errored, it will set it to a obj
						// hotkey: may be undefined if "none associated" with the `reason`
						// reason

					// populate `errored` and `__REGISTERED` of `hotkey`s
					for (var obj_failed_regs of obj_failed_regs_arr) {
						var { __ERROR, __REGISTREDs } = obj_failed_regs;

						if (__ERROR && !errored) {
							errored = __ERROR;
							if (errored.hotkeyid) {
								// find the `hotkey` entry associated with it, as in next block i will delete all hotkey.temp_hotkeyid
								errored.hotkey = hotkeys.find( el => el.temp_hotkeyid === __ERROR.hotkeyid );
								delete errored.hotkeyid;
							}
						}

						if (Object.keys(__REGISTREDs).length) {
							// if any were succesfully registered, then go through add the `__REGISTERED` object to the associated `hotkey` entry. find association by `hotkey.temp_hotkeyid`
							for (var hotkey of hotkeys) {
								var { temp_hotkeyid:hotkeyid } = hotkey;

								if (__REGISTREDs[hotkeyid]) {
									hotkey.__REGISTERED = __REGISTREDs[hotkeyid];
									hotkey.__REGISTERED.hotkeyid = hotkeyid;
								}
							}
						}
					}

					// delete temp_hotkeyid
					for (var hotkey of hotkeys) {
						delete hotkey.temp_hotkeyid;
					}

					if (errored) {
						hotkeysUnregister(); // unregister whatever was registered, if any were
						deferredmain.resolve(errored);
					} else {
						deferredmain.resolve(); // resolve with `undefined` indicating no error
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
					var keycodesArrCI = parseInt(cutils.jscGetDeepest(keycodesArrC[i]));
					if (cutils.jscEqual(keycodesArrC[i], ostypes.CONST.XCB_NO_SYMBOL)) {
						break;
					} else {
						if (!code_os_to_codes_os[code].includes(keycodesArrCI)) {
							code_os_to_codes_os[code].push(keycodesArrCI);
						}
					}
				}
				console.info('code_os_to_codes_os[code]:', code_os_to_codes_os[code]);
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

			console.info('code_os_to_codes_os:', code_os_to_codes_os);

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
			console.info('grabwins:', grabwins);

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
						var registered_codes_os = [];
						var failed_codeos;
						for (var code_os of codes_os) {
							var rez_grab = ostypes.API('xcb_grab_key_checked')(ostypes.HELPER.cachedXCBConn(), 1, grabwin, mods_os, code_os, ostypes.CONST.XCB_GRAB_MODE_ASYNC, ostypes.CONST.XCB_GRAB_MODE_ASYNC);
							var rez_check = ostypes.API('xcb_request_check')(ostypes.HELPER.cachedXCBConn(), rez_grab);
							console.log('rez_check:', rez_check.toString());
							if (!rez_check.isNull()) {
								console.error('failed to register code_os:', code_os, 'with mods:', mods_os, 'on grabwin:', grabwin, 'The hotkey is already in use by another application. Find that app, and make it release this hotkey. Possibly could be in use by the "Global Keyboard Shortcuts" of the system.'); // http://i.imgur.com/cLz1fDs.png
								failed_codeos = code_os;
								break;
							} else {
								// even if just one registered, lets mark it registerd, so the `hotkeysUnregister` function will just get errors on what isnt yet registered from the set of `code_os_to_codes_os`
								// any_registered = true;
								console.log('ok registered succesfully code_os:', code_os, 'with mods:', mods_os, 'on grabwin:', grabwin);
								registered_codes_os.push(code_os);
								hotkey.__REGISTERED = {
									grabwins,
									codes_os: registered_codes_os,
									last_triggered: 0
								};
							}
						}
					}

					if (failed_codeos !== undefined) { // same as checking `if (!any_registered)`
						// nothing for any of the codeos's for this code registered on any of the grabwins
						console.error('failed to register hotkey:', hotkey);
						console.error('due to fail will not register any of the other hotkeys if there were any, and will unregister whatever was registered');
						hotkeysUnregister();
						deferredmain.resolve({
							hotkey,
							reason: 'It is most likely that this key combination is already in use by another application. Find that app, and make it release this hotkey. Possibly could be in use by the "Global Keyboard Shortcuts" of the system - http://i.imgur.com/cLz1fDs.png\n\n\nDetails: Was not able to register the `code_os` of `' + failed_codeos + '` on `grabwin` of `' + grabwin + '`. Other info: `grabwins`: ' + grabwins.toString() + ' codes_os: ' + codes_os.toString() + ' code: ' + code.toString()
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

				// returns Promise.all

				// any "carbon" or "objc" methods to unregister?
				var unreg_mt = false;
				var unreg_poll = false;

				for (var hotkey of hotkeys) {
					if (hotkey.__REGISTERED) {
						if (hotkey.mac_method == 'carbon' || hotkey.mac_method == 'obj') {
							unreg_mt = true;
						} else if (hotkey.mac_method == 'corefoundation') {
							unreg_poll = true;
						}
					}
				}

				var promiseall_arr = [];
				if (unreg_mt) {
					var deferred_unregmt = new Deferred();
					promiseall_arr.push(deferred_unregmt.promise);

					callInBootstrap('hotkeysUnregisterMt', { hotkeys }, function() {
						for (var hotkey of hotkeys) {
							delete hotkey.__REGISTERED;
						}
						deferred_unregmt.resolve()
					});
				}
				if (unreg_poll) {
					var deferred_unregpoll = new Deferred();
					promiseall_arr.push(deferred_unregpoll.promise);

					console.log('gShtkPollStuff:', gShtkPollStuff);
					var runloop_ref = ostypes.TYPE.CFRunLoopRef(ctypes.UInt64(gShtkPollStuff.runloop_ref_strofptr))
					ostypes.API('CFRunLoopStop')(runloop_ref);

					callInShtkPollWorker('hotkeysUnregisterPl', null, function() {
						for (var hotkey of hotkeys) {
							delete hotkey.__REGISTERED;
						}
						deferred_unregpoll.resolve()
					});
				}

				return Promise.all(promiseall_arr);

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
					// by meta i mean "Win" key on windows. xcb likes to call meta the alt key. so i go with "Win" key					mods_os |= ostypes.CONST.XCB_MOD_MASK_4
				}
			}
	}

	return mods_os;
}

function hotkeysNonce(length) {
	// generates a nonce
	var text = '';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for(var i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// not needed, because the onBeforeTerminate of the shtkMainworkerSubscript will already call this. and as this gets terminated, all its child workers will be terminated. and this will not terminate till `hotkeysUnregister` is done, well as long as devuser did `onBeforeTerminate` in `MainWorker.js` and in it calls `hotkeysUnregister()`. they should, i told them to in README.md and I do so in this jscSystemHotkey-demo
// function onBeforeShtkPollerTerminate() {
// 	return new Promise(resolve =>
//   	  callInShtkPollWorker( 'onBeforeTerminate', null, ()=>resolve() )
//     );
// }
