### NOT YET READY FOR USE as of Aug 18th 2016
###### I have only wrote the design in the README.md and created blank files

## Dependency Submodules
Make sure to import [Noitidart/ostypes](https://github.com/Noitidart/ostypes) and [Noitidart/Comm](https://github.com/Noitidart/Comm) submodules first.

## Import
Add this submodule to your project like this:

    git submodule add git@github.com:Noitidart/jscSystemHotkey OPTIONAL/CUSTOM/FOLDER/PATH/HERE

## Usage
This code is meant to be used from a `ChromeWorker`. This is the central area you will control it from. the `shtkMainthreadSubscript.js` is only needed because hotkeys on a Mac system require the callbacks be setup on the mainthread.

### Step 1 - Import the subscripts

In `bootstrap.js` or `main.js` or whatever you are using for your main thread put this:

    // you need to `Services` module
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
		hotkeys: undefined // array of objects we set based on platform below
	};

	// we set the hotkeys based on the platform
	switch (OS.Constants.Sys.Name.toLowerCase()) {
		case 'winnt':
		case 'winmo':
		case 'wince':
				gHKI.hotkeys = [
					{
						code: ostypes.CONST.VK_SPACE,
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
					}
				];
			break;
		case 'darwin':
				gHKI.hotkeys = [
					{
						code: ostypes.CONST.KEY_Space,
						mods: {
							shift: true
						},
						desc: 'Shift + Space Bar'
					}
				];
			break;
		default:
			// xcb (*nix/bsd)
			gHKI.hotkeys = [
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true
					},
					desc: 'Shift + Space Bar'
				},
				// because xcb (*nix/bsd) count capslock and numlock, we need to add three more combos just for these
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						capslock: true
					},
					desc: 'Shift + Space Bar'
				},
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						numlock: true
					},
					desc: 'Shift + Space Bar'
				},
				{
					code: ostypes.CONST.XK_Space,
					mods: {
						shift: true,
						capslock: true,
						numlock: true
					},
					desc: 'Shift + Space Bar'
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
>     // THE WORKER CODE FROM "STEP 1" FROM ABOVE
