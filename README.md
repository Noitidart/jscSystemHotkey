## Announcements
###### ***August 19, 2016*** - In working order. On Mac, the "corefoundation" method does not yet accept modifiers. The "objc" method was not yet implemented, no real need to, as the "corefoundation" method does it all. If the "objc" method is requested, I have the code ready and can bring it in.

## Demo
Download `CommPlayground.xpi` and load it as a temporary addon from `about:debugging` from here - [Noitidart/CommPlayground ::  Branch:jscSystemHotkey-demo](https://github.com/Noitidart/CommPlayground/tree/jscSystemHotkey-demo).

The hotkey is "Shift + Space Bar", and on Mac a second hotkey of the "Play" media key. Open your "Browser Console" (Ctrl/Cmd + Shift + J) and you will see a message saying "blah triggered by hotkey!".

## Dependency Submodules
Make sure to import [Noitidart/ostypes](https://github.com/Noitidart/ostypes) and [Noitidart/Comm](https://github.com/Noitidart/Comm) submodules first.

## Usage
This code is meant to be used from a `ChromeWorker`. This is the central area you will control it from. the `shtkMainthreadSubscript.js` is only needed because hotkeys on a Mac system require the callbacks be setup on the mainthread.

### Step 1 - Import Submodules
Import "ostypes", "Comm", and "jscSystemHotkey" submodules. This is how you import submodules:

    git submodule add git@github.com:Noitidart/jscSystemHotkey OPTIONAL/CUSTOM/FOLDER/PATH/HERE

### Step 2 - Create Paths JSON File
In the directory containting the "jscSystemHotkey" submodule directory, place a file called `shtkPaths.json` and populate the paths to the submodule directories like this:

    {
    	"jscsystemhotkey": "chrome://jscsystemhotkey-demo/content/resources/scripts/jscSystemHotkey/",
    	"comm": "chrome://jscsystemhotkey-demo/content/resources/scripts/Comm/",
    	"ostypes": "chrome://jscsystemhotkey-demo/content/resources/scripts/ostypes/"
    }

### Step 3 - Main Thread Subscript
In `bootstrap.js` or `main.js` or whatever you are using for your main thread put this:

    // we need `Services` object
	// var { ChromeWorker, Cu } = require('chrome'); // SDK
	var { utils:Cu } = Components; // non-SDK
	Cu.import('resource://gre/modules/Services.jsm');

    Services.scriptloader.loadSubScript('YOUR/PATH/TO/jscSystemHotkey/shtkMainthreadSubscript.js');

Make sure to also `loadSubScript` of `ostypes` submodule.

#### Handle termination
In case the user disables/uninstalls your addon while the hotkey are registred, you should make sure to include a `hotkeysUnregister()` before the worker is terminated. This uses a key featue of `Comm` submodule. You should add this to your before termination procedure.

    function onBeforeTerminate() {
        return new Promise(resolve =>
            callInMainworker( 'onBeforeTerminate', null, ()=>resolve() )
        );
    }

This is a lesson on Comm sumbodule, you would put this function as the 4th argument of `new Comm.server.worker`:

    gWkComm = new Comm.server.worker('YOUR/PATH/TO/MainWorker.js', ()=>{TOOLKIT}, undefined, onBeforeTerminate )


### Step 4 - ChromeWorker Subscript
At the top of your main worker put this:

    importScripts('YOUR/PATH/TO/jscSystemHotkey/shtkMainworkerSubscript.js');

Make sure to also `importScripts` the `ostypes` submodule.

#### Handle worker side termination
Make sure it returns/includes-a-return with the promise from `hotkeysUnregister`. As unregistration is done asynchronously on Macs.

	function onBeforeTerminate() {
		var promiseall_arr = [];

		promiseall_arr.push(hotkeysUnregister()); // on mac its a promise, on others its not, but `Promise.all` works fine with non-promise entries in its array

		// any other things you want to do before terminate, push it to promiseall_arr

		return Promise.all(promiseall_arr);
	}

### Step 5 - Defined Hotkeys and Callbacks
Now in your worker setup your hotkeys in a global called `gHKI`.

	var gHKI = { // stands for globalHotkeyInfo
        jscsystemhotkey_module_path: 'YOUR/PATH/TO/jscSystemHotkey/', // the ending `/` is important
		loop_interval_ms: 200, // only for windows and xcb - you can think of this as "if a user hits the hotkey, it will not be detected until `loop_interval_ms`ms later". You may want to reduce to less then 200ms, but probably not more then 25ms.
		min_time_between_repeat: 1000, // if a the user holds down the hotkey, it will not trigger. the user must release the hotkey and wait `min_time_between_repeat`ms before being able to trigger the hotkey again
		hotkeys: undefined, // array of objects we set based on platform below
		callbacks: { // `key` is any string, and value is a function, you will use the `key` in the `callback` field of each hotkey, see `hotkeys` array below
			blah: function() {
				console.log('blah triggered by hotkey!')
			},
            another_callback: function() {

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
					code: ostypes.CONST.XK_Space, // can use any `ostypes.CONST.XK_***` or `ostypes.CONST.XF86***`, see `ostypes_x11.jsm` for list of values, not all values are there, if any missing please submit a PR to "ostypes" repo, or let me know and I'll add it in
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

### Step 6 - Register/Unregister
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

> ***NOTE*** You need to use worker. This subodule promotes the use of a worker. If you do not have one, see the [Demo](https://github.com/Noitidart/jscSystemHotkey#demo) to see how to use `Comm` submodule to setup a ChromeWorker and talk to it from the mainthread.

### About `mac_method`
###### `string; enum['carbon', 'corefoundation', 'objc']`

This key is available only to Mac OS X. Possible values are `carbon`, `corefoundation`, or `objc`.

#### `carbon`
The `carbon` method sets up a call on the main thread. It relies on the main application event loop. For `code` you should use `ostypes.CONST.KEY_***`. All of these hotkeys will be system wide. However it does not support `ostypes.CONST.NX_***` for `code`. For this you would have to use `corefoundation` or `objc`.

#### `objc`
The `objc` method also setups a call on the main thread. You can use `ostypes.CONST.NX_***` for values of `code`. You can use this to register the `F` keys. Such as media key play you would use `ostypes.CONST.NX_KEYTYPE_PLAY`. Some keys with this method register system wide, as is the intention of this submodule. However most keys register only locally in the application. I think all `ostypes.CONST.NX_***` regsitered with this method are global. I am not sure. For the `ostypes.CONST.NX_KEYTYPE_PLAY` it is for sure, however iTunes will interfere. If you want to register the "Play" key without interference from iTunes then you have to use `corefounation`.

#### `corefoundation`
The `corfoundation` does not use the main thread. It spawns another worker and runs a poll. You can use `ostypes.CONST.NX_***` for code here. Same situation as `objc`, this does not register system wide for all hotkeys, only for sume. I think all "F" keys, like "Play" will register globally. The media key "Play" does and iTunes will not interfere with it.
