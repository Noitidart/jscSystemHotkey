## Announcements
###### ***August 18, 2016*** - Not yet ready for use. I have only wrote out the design in the README.md and created blank files.

## Dependency Submodules
Make sure to import [Noitidart/ostypes](https://github.com/Noitidart/ostypes) and [Noitidart/Comm](https://github.com/Noitidart/Comm) submodules first.

## Import
Add this submodule to your project like this:

    git submodule add git@github.com:Noitidart/jscSystemHotkey OPTIONAL/CUSTOM/FOLDER/PATH/HERE

## Usage
This code is meant to be used from a `ChromeWorker`. This is the central area you will control it from. the `shtkMainthreadSubscript.js` is only needed because hotkeys on a Mac system require the callbacks be setup on the mainthread.

In `bootstrap.js` or `main.js` or whatever you are using for your main thread put this:

    // we need `Services` object
	// var { ChromeWorker, Cu } = require('chrome'); // SDK
	var { Cu } = Components; // non-SDK
	Cu.import('resource://gre/modules/Services.jsm');

    Services.scriptloader.loadSubScript('YOUR/PATH/TO/jscSystemHotkey/shtkMainthreadSubscript.js');

At the top of your main worker put this:

    importScripts('YOUR/PATH/TO/jscSystemHotkey/shtkMainworkerSubscript.js');

Now in your worker setup your hotkeys in a global called `gHKI`.

	var gHKI = { // stands for globalHotkeyInfo
		loop_interval_ms: 200, // only for windows and xcb - you can think of this as "if a user hits the hotkey, it will not be detected until `loop_interval_ms`ms later".
		min_time_between_repeat: 1000, // if a the user holds down the hotkey, it will not trigger. the user must release the hotkey and wait `min_time_between_repeat`ms before being able to trigger the hotkey again
		hotkeys: undefined, // array of objects we set based on platform below
		callbacks: { // `key` is any string, and value is a function, you will use the `key` in the `callback` field of each hotkey, see `hotkeys` array below
			blah: function() {
				console.log('blah triggered by hotkey!')
			}
		}
	};

	// we set the hotkeys based on the platform
	switch (OS.Constants.Sys.Name.toLowerCase()) {
		case 'winnt':
		case 'winmo':
		case 'wince':
				gHKI.hotkeys = [
					{
						code: ostypes.CONST.VK_SPACE, // can use any `ostypes.CONST.VK_***` or `ostypes.CONST.vk_***`, see `ostypes_win.jsm` for list of values
						mods: {
							/* List of boolean keys
							 *   shift
							 *   ctrl
							 *   alt
							 *   meta
							 *   capslock - xcb (*nix/bsd) only
							 *   numlock - xcb (*nix/bsd) only
							 */
							shift: true
						},
						desc: 'Shift + Space Bar', // this is the description in english (or whatever language) of the key combination described by `code` and `mods`. this is used when teling which hotkey failed to register
						callback: 'blah' // string - key of the callback in the `gHKI.callbacks` object
					}
				];
			break;
		case 'darwin':
				gHKI.hotkeys = [
					{
						code: ostypes.CONST.KEY_Space,  // can use any `ostypes.CONST.KEY_***` or `ostypes.CONST.NX_***`, see `ostypes_mac.jsm` for list of values. See section "About mac_method" to see which method supports which keys, I haven't fully studied this, so please your knowledge/experiences with it
						mods: {
							shift: true
						},
						desc: 'Shift + Space Bar',
						callback: 'blah',
						mac_method: 'carbon' // this key is only available to macs, see the section "About mac_method" to learn about this // other possible values are 'corefoundation' and 'objc'
					}
				];
			break;
		default:
			// xcb (*nix/bsd)
			gHKI.hotkeys = [
				{
					code: ostypes.CONST.XK_Space, // can use any `ostypes.CONST.XK_***`, see `ostypes_x11.jsm` for list of values
					mods: {
						shift: true
					},
					desc: 'Shift + Space Bar',
					callback: 'blah'
				},
				// because xcb (*nix/bsd) count capslock and numlock, we need to add three more combos just for these
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						capslock: true
					},
					desc: 'Shift + Space Bar',
					callback: 'blah'
				},
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						numlock: true
					},
					desc: 'Shift + Space Bar',
					callback: 'blah'
				},
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						capslock: true,
						numlock: true
					},
					desc: 'Shift + Space Bar',
					callback: 'blah'
				}
			];
	}

Now whenever you are ready to listen for hotkeys do:

    hotkeysRegister().then(function(failed) {
		if (failed) {
			// failed is an object with two keys `reason` and `hotkey`
			console.error('Failed to register due to error registering "' + failed.hotkey.desc + '". Reason given was:', failed.reason);
		}
	});

And whenever you want to stop listening do:

	var unreg = hotkeysUnregister();
	if (unreg.constructor.name == 'Promise') {
		unreg.then(() => {
			console.log('Unregistering hotkeys done');
		});
	} else {
		console.log('Unregistering hotkeys done');
	}

In case the user disables/uninstalls your addon while the hotkey are registred, you should make sure to include a `hotkeysUnregister()` before the work is terminated. You have to be using `Comm` submodule, so you can have this function in your main worker:

	function onBeforeTerminate() {
		var promiseall_arr = [];

		promiseall_arr.push(hotkeysUnregister()); // on mac its a promise, on others its not, but `Promise.all` works fine with non-promise entries in its array

		// any other things you want to do before terminate, push it to promiseall_arr

		return Promise.all(promiseall_arr);
	}

And then on the main thread side, when you spawn the worker you would have it do this on before termination, for example:

	function onBeforeTerminate() {
		return new Promise(resolve =>
			callInMainworker( 'onBeforeTerminate', null, ()=>resolve() )
		);
	}

	gWkComm = new Comm.server.worker('YOUR/PATH/TO/MainWorker.js', ()=>{TOOLKIT}, undefined, onBeforeTerminate )

>__NOTE__ You need to use worker. If you do not have a main worker then create one. In this example I will create one called `MainWorker.js`.
>
>     // Globals
>     var gWkComm;
>     const TOOLKIT = Services.appinfo.widgetToolkit.toLowerCase(); // needed for Linux to detect if should use GTK2 or GTK3
>     
>     // Imports
>     Services.scriptloader.loadSubScript('YOUR/PATH/TO/Comm.js');
>     var { callInMainworker } = CommHelper.bootstrap;
>     
>     // Setup the worker
>     function onBeforeTerminate() {
>     	return new Promise(resolve =>
>     		callInMainworker( 'onBeforeTerminate', null, ()=>resolve() )
>     	);
>     }
>     gWkComm = new Comm.server.worker('YOUR/PATH/TO/MainWorker.js', ()=>{TOOLKIT}, undefined, onBeforeTerminate );
>     
>     // Register the hotkeys
>     callInMainworker('hotkeysRegister', null, function(failed) {
>     	console.error('Failed to register due to error registering "' + failed.hotkey.desc + '". Reason given was:', failed.reason);
>     });
>
> The contents of `MainWorker.js` is the code from __Step 1__ and then this:
>
>     // Globals
>     var core = { os:{ toolkit: null } };
>     
>     // Imports
>     importScripts('YOUR/PATH/TO/Comm.js');
>     var { callInBootstrap } = CommHelper.mainworker;
>     
>     // Setup communication layer with bootstrap
>     var gBsComm = new Comm.client.worker();
>     function onBeforeTerminate() {
>     	var promiseall_arr = [];
>     	promiseall_arr.push(hotkeysUnregister()); // on mac its a promise, on others its not, but `Promise.all` works fine with non-promise entries in its array
>     	// any other things you want to do before terminate, push it to promiseall_arr
>     	return Promise.all(promiseall_arr);
>     }
>     
>     function init(aArg) {
>     	var { TOOLKIT } = aArg;
>     	core.os.toolkit = TOOLKIT; // needed for ostypes for linux to know if should use GTK2 or GTK3
>     }
>     
>     // THE WORKER CODE FROM "STEP 1" FROM ABOVE

### About `mac_method`
###### `string; enum['carbon', 'corefoundation', 'objc']`

This key is available only to Mac OS X. Possible values are `carbon`, `corefoundation`, or `objc`.

#### `carbon`
The `carbon` method sets up a call on the main thread. It relies on the main application event loop. For `code` you should use `ostypes.CONST.KEY_***`. All of these hotkeys will be system wide. However it does not support `ostypes.CONST.NX_***` for `code`. For this you would have to use `corefoundation` or `objc`.

#### `objc`
The `objc` method also setups a call on the main thread. You can use `ostypes.CONST.NX_***` for values of `code`. You can use this to register the `F` keys. Such as media key play you would use `ostypes.CONST.NX_KEYTYPE_PLAY`. Some keys with this method register system wide, as is the intention of this submodule. However most keys register only locally in the application. I think all `ostypes.CONST.NX_***` regsitered with this method are global. I am not sure. For the `ostypes.CONST.NX_KEYTYPE_PLAY` it is for sure, however iTunes will interfere. If you want to register the "Play" key without interference from iTunes then you have to use `corefounation`.

#### `corefoundation`
The `corfoundation` does not use the main thread. It spawns another worker and runs a poll. You can use `ostypes.CONST.NX_***` for code here. Same situation as `objc`, this does not register system wide for all hotkeys, only for sume. I think all "F" keys, like "Play" will register globally. The media key "Play" does and iTunes will not interfere with it.
