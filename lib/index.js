'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _debug2 = require('debug');

var _debug3 = _interopRequireDefault(_debug2);

var _eventemitter = require('eventemitter2');

var _urlParse = require('url-parse');

var _urlParse2 = _interopRequireDefault(_urlParse);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var debug = {
	log: (0, _debug3.default)('superlogin:log'),
	info: (0, _debug3.default)('superlogin:info'),
	warn: (0, _debug3.default)('superlogin:warn'),
	error: (0, _debug3.default)('superlogin:error')
};

// Capitalizes the first letter of a string
function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

function parseHostFromUrl(url) {
	var parsedURL = new _urlParse2.default(url);
	return parsedURL.host;
}

function checkEndpoint(url, endpoints) {
	var host = parseHostFromUrl(url);
	for (var i = 0; i < endpoints.length; i += 1) {
		if (host === endpoints[i]) {
			return true;
		}
	}
	return false;
}
function isStorageAvailable() {
	var mod = '__STORAGE__';
	try {
		localStorage.setItem(mod, mod);
		localStorage.removeItem(mod);
		return true;
	} catch (e) {
		return false;
	}
}

function parseError(err) {
	// if no connection can be established we don't have any data thus we need to forward the original error.
	if (err && err.response && err.response.data) {
		return err.response.data;
	}
	return err;
}

var memoryStorage = {
	setItem: function setItem(key, value) {
		memoryStorage.storage.set(key, value);
	},
	getItem: function getItem(key) {
		var value = memoryStorage.storage.get(key);
		if (typeof value !== 'undefined') {
			return value;
		}
		return null;
	},
	removeItem: function removeItem(key) {
		memoryStorage.storage.delete(key);
	},
	storage: new Map()
};

var Superlogin = function (_EventEmitter) {
	_inherits(Superlogin, _EventEmitter);

	function Superlogin() {
		_classCallCheck(this, Superlogin);

		var _this = _possibleConstructorReturn(this, (Superlogin.__proto__ || Object.getPrototypeOf(Superlogin)).call(this));

		_this._oauthComplete = false;
		_this._config = {};
		_this._refreshInProgress = false;
		_this._http = _axios2.default.create();
		return _this;
	}

	_createClass(Superlogin, [{
		key: 'configure',
		value: function configure() {
			var _this2 = this;

			var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

			if (config.serverUrl) {
				this._http = _axios2.default.create({
					baseURL: config.serverUrl,
					timeout: config.timeout
				});
			}

			config.baseUrl = config.baseUrl || '/auth';
			config.baseUrl = config.baseUrl.replace(/\/$/, ''); // remove trailing /
			config.socialUrl = config.socialUrl || config.baseUrl;
			config.socialUrl = config.socialUrl.replace(/\/$/, ''); // remove trailing /
			config.local = config.local || {};
			config.local.usernameField = config.local.usernameField || 'username';
			config.local.passwordField = config.local.passwordField || 'password';

			if (!config.endpoints || !(config.endpoints instanceof Array)) {
				config.endpoints = [];
			}
			if (!config.noDefaultEndpoint) {
				var defaultEndpoint = window.location.host;
				if (config.serverUrl) {
					defaultEndpoint = parseHostFromUrl(config.serverUrl);
				}
				config.endpoints.push(defaultEndpoint);
			}
			config.providers = config.providers || [];
			config.timeout = config.timeout || 0;

			if (!isStorageAvailable()) {
				this.storage = memoryStorage;
			} else if (config.storage === 'session') {
				this.storage = window.sessionStorage;
			} else {
				this.storage = window.localStorage;
			}

			this._config = config;

			// Setup the new session
			// support storage of session async or sync
			return Promise.resolve(this.storage.getItem('superlogin.session')).then(function (rawSession) {
				_this2._session = JSON.parse(rawSession);
				_this2._httpInterceptor();
				// Check expired
				if (config.checkExpired) {
					_this2.checkExpired();
					_this2.validateSession().then(function () {
						_this2._onLogin(_this2._session);
					}).catch(function () {
						// ignoring
					});
				}
			});
		}
	}, {
		key: '_httpInterceptor',
		value: function _httpInterceptor() {
			var _this3 = this;

			var request = function request(req) {
				var config = _this3.getConfig();

				if (req.skipRefresh) {
					return Promise.resolve(req);
				}

				return _this3.checkRefresh().then(function () {
					return _this3.getSession();
				}).then(function (session) {
					if (!session || !session.token) {
						return Promise.resolve(req);
					}

					if (checkEndpoint(req.url, config.endpoints)) {
						req.headers.Authorization = 'Bearer ' + session.token + ':' + session.password;
					}
					return req;
				});
			};

			var responseError = function responseError(error) {
				var config = _this3.getConfig();

				// if there is not config obj in in the error it means we cannot check the endpoints.
				// This happens for example if there is no connection at all because axion just forwards the raw error.
				if (!error || !error.config) {
					return Promise.reject(error);
				}

				// If there is an unauthorized error from one of our endpoints and we are logged in...
				if (checkEndpoint(error.config.url, config.endpoints) && error.response && error.response.status === 401 && _this3.authenticated()) {
					debug.warn('Not authorized');
					return _this3._onLogout('Session expired');
				}
				return Promise.reject(error);
			};
			// clear interceptors from a previous configure call
			this._http.interceptors.request.eject(this._httpRequestInterceptor);
			this._http.interceptors.response.eject(this._httpResponseInterceptor);

			this._httpRequestInterceptor = this._http.interceptors.request.use(request.bind(this));
			this._httpResponseInterceptor = this._http.interceptors.response.use(null, responseError.bind(this));
		}
	}, {
		key: 'authenticated',
		value: function authenticated() {
			return !!(this._session && this._session.user_id);
		}
	}, {
		key: 'getConfig',
		value: function getConfig() {
			return this._config;
		}
	}, {
		key: 'validateSession',
		value: function validateSession() {
			var _this4 = this;

			if (!this.authenticated()) {
				return Promise.reject();
			}
			return this._http.get(this._config.baseUrl + '/session').catch(function (err) {
				_this4._onLogout('Session expired');
				throw parseError(err);
			});
		}
	}, {
		key: 'getSession',
		value: function getSession() {
			var _this5 = this;

			if (!this._session) {
				return Promise.resolve(this.storage.getItem('superlogin.session')).then(function (rawSession) {
					_this5._session = JSON.parse(rawSession);
					return _this5._session ? Object.assign(_this5._session) : null;
				});
			}

			return Promise.resolve(this._session ? Object.assign(this._session) : null);

			// if (!this._session) {
			// 	this._session = JSON.parse(this.storage.getItem('superlogin.session'));
			// }
			// return this._session ? Object.assign(this._session) : null;
		}
	}, {
		key: 'setSession',
		value: function setSession(session) {
			this._session = session;
			return Promise.resolve(this.storage.setItem('superlogin.session', JSON.stringify(this._session))).then(function () {
				debug.info('New session set');
			});
		}
	}, {
		key: 'deleteSession',
		value: function deleteSession() {
			var _this6 = this;

			return Promise.resolve(this.storage.removeItem('superlogin.session')).then(function () {
				_this6._session = null;
			});
		}
	}, {
		key: 'getDbUrl',
		value: function getDbUrl(dbName) {
			if (this._session.userDBs && this._session.userDBs[dbName]) {
				return this._session.userDBs[dbName];
			}
			return null;
		}
	}, {
		key: 'getHttp',
		value: function getHttp() {
			return this._http;
		}
	}, {
		key: 'confirmRole',
		value: function confirmRole(role) {
			if (!this._session || !this._session.roles || !this._session.roles.length) return false;
			return this._session.roles.indexOf(role) !== -1;
		}
	}, {
		key: 'confirmAnyRole',
		value: function confirmAnyRole(roles) {
			if (!this._session || !this._session.roles || !this._session.roles.length) return false;
			for (var i = 0; i < roles.length; i += 1) {
				if (this._session.roles.indexOf(roles[i]) !== -1) return true;
			}
			return false;
		}
	}, {
		key: 'confirmAllRoles',
		value: function confirmAllRoles(roles) {
			if (!this._session || !this._session.roles || !this._session.roles.length) return false;
			for (var i = 0; i < roles.length; i += 1) {
				if (this._session.roles.indexOf(roles[i]) === -1) return false;
			}
			return true;
		}
	}, {
		key: 'checkRefresh',
		value: function checkRefresh() {
			// Get out if we are not authenticated or a refresh is already in progress
			if (this._refreshInProgress) {
				return Promise.resolve();
			}
			if (!this._session || !this._session.user_id) {
				return Promise.reject();
			}
			// try getting the latest refresh date, if not available fall back to issued date
			var refreshed = this._session.refreshed || this._session.issued;
			var expires = this._session.expires;
			var threshold = isNaN(this._config.refreshThreshold) ? 0.5 : this._config.refreshThreshold;
			var duration = expires - refreshed;
			var timeDiff = this._session.serverTimeDiff || 0;
			if (Math.abs(timeDiff) < 5000) {
				timeDiff = 0;
			}
			var estimatedServerTime = Date.now() + timeDiff;
			var elapsed = estimatedServerTime - refreshed;
			var ratio = elapsed / duration;
			if (ratio > threshold) {
				debug.info('Refreshing session');
				return this.refresh().then(function (session) {
					debug.log('Refreshing session sucess', session);
					return session;
				}).catch(function (err) {
					debug.error('Refreshing session failed', err);
					throw err;
				});
			}
			return Promise.resolve();
		}
	}, {
		key: 'checkExpired',
		value: function checkExpired() {
			// This is not necessary if we are not authenticated
			if (!this.authenticated()) {
				return Promise.resolve();
			}
			var expires = this._session.expires;
			var timeDiff = this._session.serverTimeDiff || 0;
			// Only compensate for time difference if it is greater than 5 seconds
			if (Math.abs(timeDiff) < 5000) {
				timeDiff = 0;
			}
			var estimatedServerTime = Date.now() + timeDiff;
			if (estimatedServerTime > expires) {
				return this._onLogout('Session expired');
			}
			return Promise.resolve();
		}
	}, {
		key: 'refresh',
		value: function refresh() {
			var _this7 = this;

			return this.getSession().then(function (session) {
				_this7._refreshInProgress = true;
				return _this7._http.post(_this7._config.baseUrl + '/refresh', {}).then(function (res) {
					_this7._refreshInProgress = false;
					if (res.data.token && res.data.expires) {
						Object.assign(session, res.data);
						_this7.setSession(session);
						_this7._onRefresh(session);
					}
					return session;
				}).catch(function (err) {
					_this7._refreshInProgress = false;
					throw parseError(err);
				});
			});
		}
	}, {
		key: 'authenticate',
		value: function authenticate() {
			var _this8 = this;

			return new Promise(function (resolve) {
				_this8.getSession().then(function (session) {
					if (session) {
						resolve(session);
					} else {
						_this8.on('login', function (newSession) {
							resolve(newSession);
						});
					}
				});
			});
		}
	}, {
		key: 'login',
		value: function login(credentials) {
			var _this9 = this;

			var _config$local = this._config.local,
			    usernameField = _config$local.usernameField,
			    passwordField = _config$local.passwordField;

			if (!credentials[usernameField] || !credentials[passwordField]) {
				return Promise.reject({ error: 'Username or Password missing...' });
			}
			return this._http.post(this._config.baseUrl + '/login', credentials, { skipRefresh: true }).then(function (res) {
				res.data.serverTimeDiff = res.data.issued - Date.now();
				return _this9.setSession(res.data).then(function () {
					_this9._onLogin(res.data);
					return res.data;
				});
			}).catch(function (err) {
				_this9.deleteSession();
				throw parseError(err);
			});
		}
	}, {
		key: 'register',
		value: function register(registration) {
			var _this10 = this;

			return this._http.post(this._config.baseUrl + '/register', registration, { skipRefresh: true }).then(function (res) {
				if (res.data.user_id && res.data.token) {
					res.data.serverTimeDiff = res.data.issued - Date.now();
					return _this10.setSession(res.data).then(function () {
						_this10._onLogin(res.data);
						_this10._onRegister(registration);
						return res.data;
					});
				}
				_this10._onRegister(registration);
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'logout',
		value: function logout(msg) {
			var _this11 = this;

			return this._http.post(this._config.baseUrl + '/logout', {}).then(function () {
				return _this11._onLogout(msg || 'Logged out');
			}).catch(function (err) {
				_this11._onLogout(msg || 'Logged out');
				if (!err.response || err.response.data.status !== 401) {
					throw parseError(err);
				}
			});
		}
	}, {
		key: 'logoutAll',
		value: function logoutAll(msg) {
			var _this12 = this;

			return this._http.post(this._config.baseUrl + '/logout-all', {}).then(function () {
				return _this12._onLogout(msg || 'Logged out');
			}).catch(function (err) {
				_this12._onLogout(msg || 'Logged out');
				if (!err.response || err.response.data.status !== 401) {
					throw parseError(err);
				}
			});
		}
	}, {
		key: 'logoutOthers',
		value: function logoutOthers() {
			return this._http.post(this._config.baseUrl + '/logout-others', {}).then(function (res) {
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'socialAuth',
		value: function socialAuth(provider) {
			var providers = this._config.providers;
			if (providers.indexOf(provider) === -1) {
				return Promise.reject({ error: 'Provider ' + provider + ' not supported.' });
			}
			var url = this._config.socialUrl + '/' + provider;
			return this._oAuthPopup(url, { windowTitle: 'Login with ' + capitalizeFirstLetter(provider) });
		}
	}, {
		key: 'tokenSocialAuth',
		value: function tokenSocialAuth(provider, accessToken) {
			var _this13 = this;

			var providers = this._config.providers;
			if (providers.indexOf(provider) === -1) {
				return Promise.reject({ error: 'Provider ' + provider + ' not supported.' });
			}
			return this._http.post(this._config.baseUrl + '/' + provider + '/token', { access_token: accessToken }).then(function (res) {
				if (res.data.user_id && res.data.token) {
					res.data.serverTimeDiff = res.data.issued - Date.now();
					_this13.setSession(res.data);
					_this13._onLogin(res.data);
				}
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'tokenLink',
		value: function tokenLink(provider, accessToken) {
			var providers = this._config.providers;
			if (providers.indexOf(provider) === -1) {
				return Promise.reject({ error: 'Provider ' + provider + ' not supported.' });
			}
			var linkURL = this._config.baseUrl + '/link/' + provider + '/token';
			return this._http.post(linkURL, { access_token: accessToken }).then(function (res) {
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'link',
		value: function link(provider) {
			var _this14 = this;

			var providers = this._config.providers;
			if (providers.indexOf(provider) === -1) {
				return Promise.reject({ error: 'Provider ' + provider + ' not supported.' });
			}
			if (this.authenticated()) {
				return this.getSession().then(function (session) {
					var token = 'bearer_token=' + session.token + ':' + session.password;
					var linkURL = _this14._config.socialUrl + '/link/' + provider + '?' + token;
					var windowTitle = 'Link your account to ' + capitalizeFirstLetter(provider);
					return _this14._oAuthPopup(linkURL, { windowTitle: windowTitle });
				});
			}
			return Promise.reject({ error: 'Authentication required' });
		}
	}, {
		key: 'unlink',
		value: function unlink(provider) {
			var providers = this._config.providers;
			if (providers.indexOf(provider) === -1) {
				return Promise.reject({ error: 'Provider ' + provider + ' not supported.' });
			}
			if (this.authenticated()) {
				return this._http.post(this._config.baseUrl + '/unlink/' + provider).then(function (res) {
					return res.data;
				}).catch(function (err) {
					throw parseError(err);
				});
			}
			return Promise.reject({ error: 'Authentication required' });
		}
	}, {
		key: 'confirmEmail',
		value: function confirmEmail(token) {
			if (!token || typeof token !== 'string') {
				return Promise.reject({ error: 'Invalid token' });
			}
			return this._http.get(this._config.baseUrl + '/confirm-email/' + token).then(function (res) {
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'forgotPassword',
		value: function forgotPassword(email) {
			return this._http.post(this._config.baseUrl + '/forgot-password', { email: email }, { skipRefresh: true }).then(function (res) {
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'resetPassword',
		value: function resetPassword(form) {
			var _this15 = this;

			return this._http.post(this._config.baseUrl + '/password-reset', form, { skipRefresh: true }).then(function (res) {
				if (res.data.user_id && res.data.token) {
					_this15.setSession(res.data);
					_this15._onLogin(res.data);
				}
				return res.data;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'changePassword',
		value: function changePassword(form) {
			if (this.authenticated()) {
				return this._http.post(this._config.baseUrl + '/password-change', form).then(function (res) {
					return res.data;
				}).catch(function (err) {
					throw parseError(err);
				});
			}
			return Promise.reject({ error: 'Authentication required' });
		}
	}, {
		key: 'changeEmail',
		value: function changeEmail(newEmail) {
			if (this.authenticated()) {
				return this._http.post(this._config.baseUrl + '/change-email', { newEmail: newEmail }).then(function (res) {
					return res.data;
				}).catch(function (err) {
					throw parseError(err);
				});
			}
			return Promise.reject({ error: 'Authentication required' });
		}
	}, {
		key: 'validateUsername',
		value: function validateUsername(username) {
			return this._http.get(this._config.baseUrl + '/validate-username/' + encodeURIComponent(username)).then(function () {
				return true;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: 'validateEmail',
		value: function validateEmail(email) {
			return this._http.get(this._config.baseUrl + '/validate-email/' + encodeURIComponent(email)).then(function () {
				return true;
			}).catch(function (err) {
				throw parseError(err);
			});
		}
	}, {
		key: '_oAuthPopup',
		value: function _oAuthPopup(url, options) {
			var _this16 = this;

			return new Promise(function (resolve, reject) {
				_this16._oauthComplete = false;
				options.windowName = options.windowTitle || 'Social Login';
				options.windowOptions = options.windowOptions || 'location=0,status=0,width=800,height=600';
				var _oauthWindow = window.open(url, options.windowName, options.windowOptions);

				if (!_oauthWindow) {
					reject({ error: 'Authorization popup blocked' });
				}

				var _oauthInterval = setInterval(function () {
					if (_oauthWindow.closed) {
						clearInterval(_oauthInterval);
						if (!_this16._oauthComplete) {
							_this16.authComplete = true;
							reject({ error: 'Authorization cancelled' });
						}
					}
				}, 500);

				window.superlogin = {};
				window.superlogin.oauthSession = function (error, session, link) {
					if (!error && session) {
						session.serverTimeDiff = session.issued - Date.now();
						_this16.setSession(session);
						_this16._onLogin(session);
						return resolve(session);
					} else if (!error && link) {
						_this16._onLink(link);
						return resolve(capitalizeFirstLetter(link) + ' successfully linked.');
					}
					_this16._oauthComplete = true;
					return reject(error);
				};
			});
		}
	}, {
		key: '_onLogin',
		value: function _onLogin(msg) {
			debug.info('Login', msg);
			this.emit('login', msg);
		}
	}, {
		key: '_onLogout',
		value: function _onLogout(msg) {
			var _this17 = this;

			return this.deleteSession().then(function () {
				debug.info('Logout', msg);
				_this17.emit('logout', msg);
			});
		}
	}, {
		key: '_onLink',
		value: function _onLink(msg) {
			debug.info('Link', msg);
			this.emit('link', msg);
		}
	}, {
		key: '_onRegister',
		value: function _onRegister(msg) {
			debug.info('Register', msg);
			this.emit('register', msg);
		}
	}, {
		key: '_onRefresh',
		value: function _onRefresh(msg) {
			debug.info('Refresh', msg);
			this.emit('refresh', msg);
		}
	}]);

	return Superlogin;
}(_eventemitter.EventEmitter2);

exports.default = new Superlogin();