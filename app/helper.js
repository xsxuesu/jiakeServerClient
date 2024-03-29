/**
 * Copyright 2017 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an 'AS IS' BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';
var log4js = require('log4js');
var logger = log4js.getLogger('Helper');
logger.setLevel('DEBUG');

var path = require('path');
var util = require('util');
var fs = require('fs-extra');
var User = require('fabric-client/lib/User.js');
var crypto = require('crypto');
var copService = require('fabric-ca-client');

var hfc = require('fabric-client');
hfc.setLogger(logger);
var ORGS = hfc.getConfigSetting('network-config');

var clients = {};
var channels = {};
var caClients = {};
const orgList = ["Nxia", "Nmen", "Dubai","Manager"];
var aliasNames = {};
var currentOrg = "Manager";

if (process.env.ORG) {
	currentOrg = process.env.ORG;
}
logger.error("======================================currentOrg:"+currentOrg);
for (let key in ORGS) {
	if (currentOrg == "Manager") {
		if (orgList.indexOf(key) >= 0) { //配置的组织是否包含其中
			let client = new hfc();
			logger.error("======================================org key:"+key);
			let cryptoSuite = hfc.newCryptoSuite();
			cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({ path: getKeyStoreForOrg(ORGS[key].name) }));
			client.setCryptoSuite(cryptoSuite);
	
			let channel = client.newChannel(hfc.getConfigSetting('channelName'));
			channel.addOrderer(newOrderer1(client));
			channel.addOrderer(newOrderer2(client));
	
			clients[key] = client;
			channels[key] = channel;
			aliasNames[key] = ORGS[key]["aliasName"];
			setupPeers(channel, key, client);
	
			let caUrl = ORGS[key].ca;
			caClients[key] = new copService(caUrl, null /*defautl TLS opts*/, '' /* default CA */, cryptoSuite);
		}
	}else{
		if (key == currentOrg) { //配置的组织是否包含其中
			let client = new hfc();
			let cryptoSuite = hfc.newCryptoSuite();
			cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({ path: getKeyStoreForOrg(ORGS[key].name) }));
			client.setCryptoSuite(cryptoSuite);
	
			let channel = client.newChannel(hfc.getConfigSetting('channelName'));
			channel.addOrderer(newOrderer1(client));
			channel.addOrderer(newOrderer2(client));
	
			clients[key] = client;
			channels[key] = channel;
			aliasNames[key] = ORGS[key]["aliasName"];
			setupPeers(channel, key, client);
	
			let caUrl = ORGS[key].ca;
			caClients[key] = new copService(caUrl, null /*defautl TLS opts*/, '' /* default CA */, cryptoSuite);
		}
	}
}

function setupPeers(channel, org, client) {
	for (let key in ORGS[org].peers) {
		let data = fs.readFileSync(path.join(__dirname, ORGS[org].peers[key]['tls_cacerts']));
		let peer = client.newPeer(
			ORGS[org].peers[key].requests,
			{
				'request-timeout': '100000',
				'pem': Buffer.from(data).toString(),
				'ssl-target-name-override': ORGS[org].peers[key]['server-hostname']
			}
		);
		peer.setName(key);

		channel.addPeer(peer);
	}
}

function newOrderer1(client) {
	var caRootsPath1 = ORGS.orderer1.tls_cacerts;
	let data1 = fs.readFileSync(path.join(__dirname, caRootsPath1));
	let caroots1 = Buffer.from(data1).toString();

	return client.newOrderer(ORGS.orderer1.url, {
		'request-timeout': '100000',
		'pem': caroots1,
		'ssl-target-name-override': ORGS.orderer1['server-hostname']
	});
}

function newOrderer2(client) {
	var caRootsPath2 = ORGS.orderer2.tls_cacerts;
	let data2 = fs.readFileSync(path.join(__dirname, caRootsPath2));
	let caroots2 = Buffer.from(data2).toString();

	return client.newOrderer(ORGS.orderer2.url, {
		'request-timeout': '100000',
		'pem': caroots2,
		'ssl-target-name-override': ORGS.orderer2['server-hostname']
	});
}

function readAllFiles(dir) {
	var files = fs.readdirSync(dir);
	var certs = [];
	files.forEach((file_name) => {
		let file_path = path.join(dir, file_name);
		let data = fs.readFileSync(file_path);
		certs.push(data);
	});
	return certs;
}

function getOrgName(org) {
	return ORGS[org]["name"];
}

function getKeyStoreForOrg(org) {
	return hfc.getConfigSetting('keyValueStore') + '_' + org;
}

function newRemotes(names, forPeers, userOrg) {
	let client = getClientForOrg(userOrg);
	let targets = [];
	// find the peer that match the names
	for (let idx in names) {
		let peerName = names[idx];
		if (ORGS[userOrg].peers[peerName]) {
			// found a peer matching the name
			let data = fs.readFileSync(path.join(__dirname, ORGS[userOrg].peers[peerName]['tls_cacerts']));
			let grpcOpts = {
				'request-timeout': '100000',
				'pem': Buffer.from(data).toString(),
				'ssl-target-name-override': ORGS[userOrg].peers[peerName]['server-hostname']
			};

			if (forPeers) {
				targets.push(client.newPeer(ORGS[userOrg].peers[peerName].requests, grpcOpts));
			} else {
				let eh = client.newEventHub();
				eh.setPeerAddr(ORGS[userOrg].peers[peerName].events, grpcOpts);
				targets.push(eh);
			}
		}
	}

	if (targets.length === 0) {
		logger.error(util.format('Failed to find peers matching the names %s', names));
	}

	return targets;
}

//-------------------------------------//
// APIs
//-------------------------------------//
var getChannelForOrg = function (org) {
	return channels[org];
};

var getClientForOrg = function (org) {
	return clients[org];
};

var newPeers = function (names, org) {
	return newRemotes(names, true, org);
};

var newEventHubs = function (names, org) {
	return newRemotes(names, false, org);
};

var getMspID = function (org) {
	logger.debug('Msp ID : ' + ORGS[org].mspid);
	return ORGS[org].mspid;
};

var getAdminUser = function (userOrg) {
	var users = hfc.getConfigSetting('admins');
	var username = users[0].username;
	var password = users[0].secret;
	var member;
	var client = getClientForOrg(userOrg);

	return hfc.newDefaultKeyValueStore({
		path: getKeyStoreForOrg(getOrgName(userOrg))
	}).then((store) => {
		client.setStateStore(store);
		// clearing the user context before switching
		client._userContext = null;
		return client.getUserContext(username, true).then((user) => {
			if (user && user.isEnrolled()) {
				logger.info('Successfully loaded member from persistence');
				return user;
			} else {
				let caClient = caClients[userOrg];
				// need to enroll it with CA server
				logger.info(caClient);
				logger.info('no logon caclient and need to enroll it with CA server!');
				return caClient.enroll({
					enrollmentID: username,
					enrollmentSecret: password
				}).then((enrollment) => {
					logger.info('Successfully enrolled user \'' + username + '\'');
					member = new User(username);
					member.setCryptoSuite(client.getCryptoSuite());
					return member.setEnrollment(enrollment.key, enrollment.certificate, getMspID(userOrg));
				}, (err) => {
					logger.error('err:' + err);
					return null;
				}).then(() => {
					return client.setUserContext(member);
				}).then(() => {
					return member;
				}).catch((err) => {
					logger.error('Failed to enroll and persist user. Error: ' + err.stack ?
						err.stack : err);
					return null;
				});
			}
		});
	});
};

var getRegisteredUsersForBack = function (username, userOrg, isJson, password) {
	logger.error(username)
	var member;
	var client = getClientForOrg(userOrg);
	var enrollmentSecret = password;
	return hfc.newDefaultKeyValueStore({
		path: getKeyStoreForOrg(getOrgName(userOrg))
	}).then((store) => {
		client.setStateStore(store);
		// clearing the user context before switching
		client._userContext = null;
		return client.getUserContext(username, true).then((user) => {
			if (user && user.isEnrolled()) {
				logger.info('Successfully loaded member from persistence');
				return user;
			} else {
				let caClient = caClients[userOrg];

				//            enroll member 成员信息
				return caClient.enroll({
					enrollmentID: username,
					enrollmentSecret: enrollmentSecret
				}).then((msg) => {
					console.log(msg);
					if (message && typeof message === 'string' && message.includes(
						'Error:')) {
						logger.error(username + ' enrollment failed');
						return message;
					}
					logger.debug(username + ' enrolled successfully');
					// 临时写人admin
					// var adminusers = hfc.getConfigSetting('admins');
					// var adminusername = adminusers[0].username;
					// var adminpassword = adminusers[0].secret;

					member = new User(username);
					member._enrollmentSecret = enrollmentSecret;
					return member.setEnrollment(message.key, message.certificate, getMspID(userOrg));
				}, (err) => {
					// enroll 失败，然后再注册登录
					logger.error(" enroll err:" + ' -------------' + err);
					return getAdminUser(userOrg).then(function (adminUserObj) {
						member = adminUserObj;
						if (!password) {
							password = "password";
						}
						return caClient.register({
							enrollmentID: username,
							enrollmentSecret: password,
							role: "client",
							affiliation: aliasNames[userOrg].toLowerCase() + ".department1",
							maxEnrollments: 1000,
							attrs: []
						}, member);
					}).then((secret) => {
						logger.debug("secret:" + ' -------------' + secret);
						enrollmentSecret = secret;
						logger.debug(username + ' registered successfully');
						return caClient.enroll({
							enrollmentID: username,
							enrollmentSecret: secret
						});
					}, (err) => {
						logger.debug(err + ':------ err');
						logger.debug(username + ' failed to register');
						return err;
						//return 'Failed to register '+username+'. Error: ' + err.stack ? err.stack : err;
					}).then((message) => {
						if (message && typeof message === 'string' && message.includes(
							'Error:')) {
							logger.error(username + ' enrollment failed');
							return message;
						}
						logger.debug(username + ' enrolled successfully');
						// 临时写人admin
						// var adminusers = hfc.getConfigSetting('admins');
						// var adminusername = adminusers[0].username;
						// var adminpassword = adminusers[0].secret;

						member = new User(username);
						member._enrollmentSecret = enrollmentSecret;
						return member.setEnrollment(message.key, message.certificate, getMspID(userOrg));
					}).then(() => {
						client.setUserContext(member);
						return member;
					}, (err) => {
						logger.error(util.format('%s enroll failed: %s', username, err.stack ? err.stack : err));
						return '' + err;
					});
				}).then(() => {
					client.setUserContext(member);
					return member;
				}, (err) => {
					logger.error(util.format('%s enroll failed: %s', username, err.stack ? err.stack : err));
					return '' + err;
				});
			}
		});
	}).then((user) => {
		if (isJson && isJson === true) {
			var response = {
				success: true,
				secret: user._enrollmentSecret,
				message: username + ' enrolled Successfully',
			};
			return response;
		}
		return user;
	}, (err) => {
		logger.error(util.format('Failed to get registered user: %s, error: %s', username, err.stack ? err.stack : err));
		return '' + err;
	});
};


var getRegisteredUsers = function(username, userOrg, isJson) {
	var member;
	console.log("userOrg:"+userOrg);
	var client = getClientForOrg(userOrg);
	var enrollmentSecret = null;
	return hfc.newDefaultKeyValueStore({
		path: getKeyStoreForOrg(getOrgName(userOrg))
	}).then((store) => {
		client.setStateStore(store);
		// clearing the user context before switching
		client._userContext = null;
		return client.getUserContext(username, true).then((user) => {
			if (user && user.isEnrolled()) {
				logger.info('Successfully loaded member from persistence');
				return user;
			} else {
				let caClient = caClients[userOrg];
				return getAdminUser(userOrg).then(function(adminUserObj) {
					member = adminUserObj;
					return caClient.register({
						enrollmentID: username,
						affiliation: aliasNames[userOrg].toLowerCase() + '.department1'
					}, member);
				}).then((secret) => {
					enrollmentSecret = secret;
					logger.debug(username + ' registered successfully');
					return caClient.enroll({
						enrollmentID: username,
						enrollmentSecret: secret
					});
				}, (err) => {
					logger.debug(username + ' failed to register');
					return '' + err;
					//return 'Failed to register '+username+'. Error: ' + err.stack ? err.stack : err;
				}).then((message) => {
					if (message && typeof message === 'string' && message.includes(
							'Error:')) {
						logger.error(username + ' enrollment failed');
						return message;
					}
					logger.debug(username + ' enrolled successfully');

					member = new User(username);
					member._enrollmentSecret = enrollmentSecret;
					return member.setEnrollment(message.key, message.certificate, getMspID(userOrg));
				}).then(() => {
					client.setUserContext(member);
					return member;
				}, (err) => {
					logger.error(util.format('%s enroll failed: %s', username, err.stack ? err.stack : err));
					return '' + err;
				});;
			}
		});
	}).then((user) => {
		if (isJson && isJson === true) {
			var response = {
				success: true,
				secret: user._enrollmentSecret,
				message: username + ' enrolled Successfully',
			};
			return response;
		}
		return user;
	}, (err) => {
		logger.error(util.format('Failed to get registered user: %s, error: %s', username, err.stack ? err.stack : err));
		return '' + err;
	});
};

var getOrgAdmin = function (userOrg) {
	console.log("======================="+userOrg);
	var admin = ORGS[userOrg].admin;
	console.log(admin);
	var keyPath = path.join(__dirname, admin.key);
	var keyPEM = Buffer.from(readAllFiles(keyPath)[0]).toString();
	var certPath = path.join(__dirname, admin.cert);
	var certPEM = readAllFiles(certPath)[0].toString();

	var client = getClientForOrg(userOrg);
	var cryptoSuite = hfc.newCryptoSuite();
	if (userOrg) {
		cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({ path: getKeyStoreForOrg(getOrgName(userOrg)) }));
		client.setCryptoSuite(cryptoSuite);
	}

	return hfc.newDefaultKeyValueStore({
		path: getKeyStoreForOrg(getOrgName(userOrg))
	}).then((store) => {
		client.setStateStore(store);

		return client.createUser({
			username: 'peer' + userOrg + 'Admin',
			mspid: getMspID(userOrg),
			cryptoContent: {
				privateKeyPEM: keyPEM,
				signedCertPEM: certPEM
			}
		});
	});
};

var setupChaincodeDeploy = function () {
	process.env.GOPATH = path.join(__dirname, hfc.getConfigSetting('CC_SRC_PATH'));
};

var getLogger = function (moduleName) {
	var logger = log4js.getLogger(moduleName);
	logger.setLevel('DEBUG');
	return logger;
};

exports.getChannelForOrg = getChannelForOrg;
exports.getClientForOrg = getClientForOrg;
exports.getLogger = getLogger;
exports.setupChaincodeDeploy = setupChaincodeDeploy;
exports.getMspID = getMspID;
exports.ORGS = ORGS;
exports.newPeers = newPeers;
exports.newEventHubs = newEventHubs;
exports.getRegisteredUsers = getRegisteredUsers;
exports.getOrgAdmin = getOrgAdmin;
exports.getAdminUser = getAdminUser;
