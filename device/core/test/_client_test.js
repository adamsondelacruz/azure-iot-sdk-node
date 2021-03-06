// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var stream = require('stream');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Client = require('../lib/client.js').Client;
var SimulatedHttp = require('./http_simulated.js');
var FakeTransport = require('./fake_transport.js');
var clientTests = require('./_client_common_testrun.js');
var results = require('azure-iot-common').results;
var errors = require('azure-iot-common').errors;
var Message = require('azure-iot-common').Message;

describe('Client', function () {
  var sharedKeyConnectionString = 'HostName=host;DeviceId=id;SharedAccessKey=key';
  describe('#constructor', function () {
    /*Tests_SRS_NODE_DEVICE_CLIENT_05_001: [The Client constructor shall throw ReferenceError if the transport argument is falsy.]*/
    it('throws if transport arg is falsy', function () {
      [null, undefined, '', 0].forEach(function (transport) {
        assert.throws(function () {
          return new Client(transport);
        }, ReferenceError, 'transport is \'' + transport + '\'');
      });
    });
  });

  describe('#fromConnectionString', function () {

    /*Tests_SRS_NODE_DEVICE_CLIENT_05_003: [The fromConnectionString method shall throw ReferenceError if the connStr argument is falsy.]*/
    it('throws if connStr arg is falsy', function () {
      [null, undefined, '', 0].forEach(function (value) {
        assert.throws(function () {
          return Client.fromConnectionString(value);
        }, ReferenceError, 'connStr is \'' + value + '\'');
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_05_006: [The fromConnectionString method shall return a new instance of the Client object, as by a call to new Client(new Transport(...)).]*/
    it('returns an instance of Client', function () {
      var client = Client.fromConnectionString(sharedKeyConnectionString, FakeTransport);
      assert.instanceOf(client, Client);
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_027: [If a connection string argument is provided and is using SharedAccessKey authentication, the Client shall automatically generate and renew SAS tokens.] */
    it('automatically renews the SAS token before it expires', function (testCallback) {
      this.clock = sinon.useFakeTimers();
      var clock = this.clock;
      var tick = 0;
      var firstTick = 1800000;
      var secondTick = 1200000;
      var sasUpdated = false;

      var client = Client.fromConnectionString(sharedKeyConnectionString, FakeTransport);
      sinon.stub(client._transport, 'updateSharedAccessSignature', function () {
        sasUpdated = true;
        assert.equal(tick, secondTick);
        clock.restore();
        testCallback();
      });

      assert.instanceOf(client, Client);
      client.open(function (err) {
        if (err) {
          testCallback(err);
        } else {
          client.sasRenewalInterval = 2700000;
          tick = firstTick;
          this.clock.tick(tick); // 30 minutes. shouldn't have updated yet.
          assert.isFalse(sasUpdated);
          tick = secondTick;
          this.clock.tick(tick); // +20 => 50 minutes. should've updated so the callback will be called and the test will terminate.
        }
      }.bind(this));
    });

    it('doesn\'t try to renew the SAS token when using x509', function (testCallback) {
      this.clock = sinon.useFakeTimers();
      var clock = this.clock;

      var x509ConnectionString = 'HostName=host;DeviceId=id;x509=true';
      var client = new Client.fromConnectionString(x509ConnectionString, FakeTransport);
      assert.instanceOf(client, Client);

      sinon.stub(client._transport, 'updateSharedAccessSignature', function () {
        clock.restore();
        testCallback(new Error('updateSharedAccessSignature should not have been called'));
      });

      this.clock.tick(3600000); // 1 hour: this should trigger the call to renew the SAS token.
      clock.restore();
      testCallback();
    });
  });

  describe('#fromSharedAccessSignature', function () {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_029: [The fromSharedAccessSignature method shall throw a ReferenceError if the sharedAccessSignature argument is falsy.] */
    it('throws if sharedAccessSignature arg is falsy', function () {
      [null, undefined, '', 0].forEach(function (value) {
        assert.throws(function () {
          return Client.fromSharedAccessSignature(value);
        }, ReferenceError, 'sharedAccessSignature is \'' + value + '\'');
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_030: [The fromSharedAccessSignature method shall return a new instance of the Client object] */
    it('returns an instance of Client', function () {
      var sharedAccessSignature = '"SharedAccessSignature sr=hubName.azure-devices.net/devices/deviceId&sig=s1gn4tur3&se=1454204843"';
      var client = Client.fromSharedAccessSignature(sharedAccessSignature, FakeTransport);
      assert.instanceOf(client, Client);
    });

    it('create a correct config when sr is not URI-encoded', function () {
      var sharedAccessSignature = '"SharedAccessSignature sr=hubName.azure-devices.net/devices/deviceId&sig=s1gn4tur3&se=1454204843"';
      var DummyTransport = function (config) {
        assert.strictEqual(config.host, 'hubName.azure-devices.net');
        assert.strictEqual(config.deviceId, 'deviceId');
        assert.strictEqual(config.hubName, 'hubName');
        assert.strictEqual(config.sharedAccessSignature, sharedAccessSignature);
      };
      Client.fromSharedAccessSignature(sharedAccessSignature, DummyTransport);
    });

    it('create a correct config when sr is URI-encoded', function () {
      var sharedAccessSignature = '"SharedAccessSignature sr=hubName.azure-devices.net%2Fdevices%2FdeviceId&sig=s1gn4tur3&se=1454204843"';
      var DummyTransport = function (config) {
        assert.strictEqual(config.host, 'hubName.azure-devices.net');
        assert.strictEqual(config.deviceId, 'deviceId');
        assert.strictEqual(config.hubName, 'hubName');
        assert.strictEqual(config.sharedAccessSignature, sharedAccessSignature);
      };
      Client.fromSharedAccessSignature(sharedAccessSignature, DummyTransport);
    });
  });

  describe('setTransportOptions', function () {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_021: [The ‘setTransportOptions’ method shall call the ‘setOptions’ method on the transport object.]*/
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_022: [The ‘done’ callback shall be invoked with a null error object and a ‘TransportConfigured’ object nce the transport has been configured.]*/
    it('calls the setOptions method on the transport object and gives it the options parameter', function (done) {
      var testOptions = { foo: 42 };
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'setOptions', function (options, callback) {
        assert.equal(options.http.receivePolicy, testOptions);
        callback(null, new results.TransportConfigured());
      });

      var client = new Client(dummyTransport);
      client.setTransportOptions(testOptions, function (err, result) {
        if (err) {
          done(err);
        } else {
          assert.equal(result.constructor.name, 'TransportConfigured');
          done();
        }
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_023: [The ‘done’ callback shall be invoked with a standard javascript Error object and no result object if the transport could not be configued as requested.]*/
    it('calls the \'done\' callback with an error object if setOptions failed', function (done) {
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'setOptions', function (options, callback) {
        var err = new Error('fail');
        callback(err);
      });

      var client = new Client(dummyTransport);
      client.setTransportOptions({ foo: 42 }, function (err) {
        assert.isNotNull(err);
        done();
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_024: [The ‘setTransportOptions’ method shall throw a ‘ReferenceError’ if the options object is falsy] */
    [null, undefined, '', 0].forEach(function (option) {
      it('throws a ReferenceError if options is ' + option, function () {
        var client = new Client(new FakeTransport());
        assert.throws(function () {
          client.setTransportOptions(option, function () { });
        }, ReferenceError);
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_025: [The ‘setTransportOptions’ method shall throw a ‘NotImplementedError’ if the transport doesn’t implement a ‘setOption’ method.]*/
    it('throws a NotImplementedError if the setOptions method is not implemented on the transport', function () {
      var client = new Client({});

      assert.throws(function () {
        client.setTransportOptions({ foo: 42 }, function () { });
      }, errors.NotImplementedError);
    });
  });

  describe('setOptions', function() {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_042: [The `setOptions` method shall throw a `ReferenceError` if the options object is falsy.]*/
    [null, undefined].forEach(function(options) {
      it('throws is options is ' + options, function() {
        var client = new Client({});
        assert.throws(function () {
          client.setOptions(options, function () { });
        }, ReferenceError);
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_043: [The `done` callback shall be invoked no parameters when it has successfully finished setting the client and/or transport options.]*/
    it('calls the done callback with no parameters when it has successfully configured the transport', function(done) {
      var client = new Client(new FakeTransport());
      client.setOptions({}, done);
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_044: [The `done` callback shall be invoked with a standard javascript `Error` object and no result object if the client could not be configured as requested.]*/
    it('calls the done callback with an error when it failed to configured the transport', function(done) {
      var failingTransport = new FakeTransport();
      sinon.stub(failingTransport, 'setOptions', function (options, done) {
        done(new Error('dummy error'));
      });

      var client = new Client(failingTransport);
      client.setOptions({}, function(err) {
        assert.instanceOf(err, Error);
        done();
      });
    });
  });

  describe('uploadToBlob', function() {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_037: [The `uploadToBlob` method shall throw a `ReferenceError` if `blobName` is falsy.]*/
    [undefined, null, ''].forEach(function (blobName) {
      it('throws a ReferenceError if \'blobName\' is ' + blobName + '\'', function() {
        var client = new Client({}, null, {});
        assert.throws(function() {
          client.uploadToBlob(blobName, new stream.Readable(), 42, function() {});
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_038: [The `uploadToBlob` method shall throw a `ReferenceError` if `stream` is falsy.]*/
    [undefined, null, ''].forEach(function (stream) {
      it('throws a ReferenceError if \'stream\' is ' + stream + '\'', function() {
        var client = new Client({}, null, {});
        assert.throws(function() {
          client.uploadToBlob('blobName', stream, 42, function() {});
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_039: [The `uploadToBlob` method shall throw a `ReferenceError` if `streamLength` is falsy.]*/
    [undefined, null, '', 0].forEach(function (streamLength) {
      it('throws a ReferenceError if \'streamLength\' is ' + streamLength + '\'', function() {
        var client = new Client({}, null, {});
        assert.throws(function() {
          client.uploadToBlob('blobName', new stream.Readable(), streamLength, function() {});
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_040: [The `uploadToBlob` method shall call the `done` callback with an `Error` object if the upload fails.]*/
    it('calls the done callback with an Error object if the upload fails', function(done) {
      var DummyBlobUploader = function () {
        this.uploadToBlob = function(blobName, stream, streamLength, callback) {
          callback(new Error('fake error'));
        };
      };

      var client = new Client({}, null, new DummyBlobUploader());
      client.uploadToBlob('blobName', new stream.Readable(), 42, function(err) {
        assert.instanceOf(err, Error);
        done();
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_041: [The `uploadToBlob` method shall call the `done` callback no parameters if the upload succeeds.]*/
    it('calls the done callback with no parameters if the upload succeeded', function (done) {
      var DummyBlobUploader = function () {
        this.uploadToBlob = function(blobName, stream, streamLength, callback) {
          callback();
        };
      };

      var client = new Client({}, null, new DummyBlobUploader());
      client.uploadToBlob('blobName', new stream.Readable(), 42, done);
    });
  });

  describe('#open', function () {
    /* Tests_SRS_NODE_DEVICE_CLIENT_12_001: [The open function shall call the transport’s connect function, if it exists.] */
    it('calls connect on the transport if the method exists', function (done) {
      var client = new Client(new FakeTransport());
      client.open(function (err, result) {
        if (err) {
          done(err);
        } else {
          assert.equal(result.constructor.name, 'Connected');
          done();
        }
      });
    });

    it('doesn\'t fail if the connect method doesn\'t exist on the transport', function (done) {
      var client = new Client(new SimulatedHttp());
      client.open(function (err, result) {
        assert.isNull(err);
        assert.equal(result.constructor.name, 'Connected');
        done();
      });
    });

    it('connects the receiver if there\'s a listener on the message event', function (done) {
      var receiver = new EventEmitter();
      receiver.on = sinon.spy();
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function (callback) {
        callback(null, receiver);
      });

      var client = new Client(dummyTransport);
      client.on('message', function () { });
      client.open(function (err, result) {
        if (err) {
          done(err);
        } else {
          assert.equal(result.constructor.name, 'Connected');
          assert(receiver.on.calledWith('message'));
          done();
        }
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_045: [If the transport successfully establishes a connection the `open` method shall subscribe to the `disconnect` event of the transport.]*/
    it('subscribes to the \'disconnect\' event once connected', function(done) {
      var transport = new FakeTransport();
      var client = new Client(transport);
      client.open(function() {
        client.on('disconnect', function() {
          done();
        });

        transport.emit('disconnect');
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_060: [The `open` method shall call the `openCallback` callback with a null error object and a `results.Connected()` result object if the transport is already connected, doesn't need to connect or has just connected successfully.]*/
    it('calls the callback without trying to connect if already connected', function(testCallback) {
      var transport = new FakeTransport();
      sinon.spy(transport, 'connect');

      var client = new Client(transport);
      client.open(function(err) {
        if (err) {
          testCallback(err);
        } else {
          assert.isTrue(transport.connect.calledOnce);
          client.open(function(err) {
            if (err) {
              testCallback(err);
            } else {
              assert.isFalse(transport.connect.calledTwice);
              testCallback();
            }
          });
        }
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_064: [The `open` method shall call the `openCallback` immediately with a null error object and a `results.Connected()` object if called while renewing the shared access signature.]*/
    it('calls the callback without trying connect while updating the shared access signature', function(testCallback) {
      var transport = new FakeTransport();
      sinon.spy(transport, 'connect');
      sinon.stub(transport, 'updateSharedAccessSignature', function(sas, callback) {
        this._updateSasCallback = callback; // will store the callback but not call it, blocking the state machine in the 'updating_sas' state.
      });

      var unblockUpdateSas = function() {
        transport._updateSasCallback(null, new results.SharedAccessSignatureUpdated()); // unblock the state machine and calls the stored callback.
      };

      var client = new Client(transport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };

      client.open(function(err) {
        if (err) {
          testCallback(err);
        } else {
          assert.isTrue(transport.connect.calledOnce);
          client.updateSharedAccessSignature('newsas');
          client.open(testCallback);
          assert.isTrue(transport.connect.calledOnce);
          unblockUpdateSas();
        }
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_061: [The `open` method shall not throw if the `openCallback` callback has not been provided.]*/
    it('doesn\'t throw if the callback hasn\'t been passed as argument', function() {
      var transport = new FakeTransport();
      var client = new Client(transport);
      assert.doesNotThrow(function() {
        client.open();
      });
    });

    [true, false].forEach( function(doReconnect) {
      it('should invoke the renew path with a reconnect of ' + doReconnect.toString(), function(testCallback){
        this.clock = sinon.useFakeTimers();
        var dummyTransport = new FakeTransport();
        sinon.stub(dummyTransport, 'updateSharedAccessSignature', function(newSas, callback) {
          callback(null, new results.SharedAccessSignatureUpdated(doReconnect));
        });

        var client = new Client(dummyTransport, sharedKeyConnectionString);
        client.blobUploadClient = { updateSharedAccessSignature: function() {} };
        var renewalInterval = Client.sasRenewalInterval;
        client.open(function(err, res) {
          if (err) {
            testCallback(err);
          } else {
            assert.strictEqual(res.constructor.name, 'Connected');
            assert(dummyTransport.updateSharedAccessSignature.notCalled);
            this.clock.tick(renewalInterval + 1);
            process.nextTick(function () {
              assert(dummyTransport.updateSharedAccessSignature.calledOnce);
              this.clock.restore();
              testCallback();
            }.bind(this));
          }
        }.bind(this));
      });
    });

    it('emits an error if the transport fails to provide a receiver when connecting', function(testCallback) {
      var fakeError = new Error('fake error');
      var transport = new FakeTransport();
      sinon.stub(transport, 'getReceiver', function(callback) {
        callback(fakeError);
      });

      var client = new Client(transport);
      client.on('error', function(err) {
        assert.equal(err, fakeError);
        testCallback();
      });

      client.open();
    });
  });

  describe('#close', function () {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_001: [The close function shall call the transport’s disconnect function if it exists.] */
    it('calls disconnect on the transport if the method exists', function (done) {
      var transport = new FakeTransport();
      sinon.stub(transport, 'disconnect', function() {
        done();
      });
      var client = new Client(transport);
      client.open(function() {
        client.close();
      });
    });

    it('calls the callback immediately if the client is already disconnected', function(testCallback) {
      var transport = new FakeTransport();
      sinon.stub(transport, 'disconnect', function() {
        assert.fail();
      });
      var client = new Client(transport);
      client.close(testCallback());
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_046: [** The `disconnect` method shall remove the listener that has been attached to the transport `disconnect` event.]*/
    it('unsubscribes for the \'disconnect\' event when disconnecting', function(done) {
      var transport = new FakeTransport();
      var client = new Client(transport);
      var disconnectReceived = false;
      client.open(function() {
        client.on('disconnect', function() {
          disconnectReceived = true;
        });
        client.close(function() {
          transport.emit('disconnect');
          assert.isFalse(disconnectReceived);
          done();
        });
      });
    });

    /*Test_SRS_NODE_DEVICE_CLIENT_16_001: [The `close` function shall call the transport's `disconnect` function if it exists.]*/
    it('disconnects the transport if called while updating the shared access signature', function(testCallback){
      var transport = new FakeTransport();
      sinon.stub(transport, 'updateSharedAccessSignature', function() {
        // will not call the callback, leaving the state machine in the 'updating_sas' state.
      });
      sinon.spy(transport, 'disconnect');

      var client = new Client(transport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };
      client.open(function() {
        client.updateSharedAccessSignature('newSas');
        client.close(function() {
          assert.isTrue(transport.disconnect.called);
          testCallback();
        });
      });
    });

    /*Test_SRS_NODE_DEVICE_CLIENT_16_001: [The `close` function shall call the transport's `disconnect` function if it exists.]*/
    it('closes the transport when called while connecting', function(testCallback) {
      var transport = new FakeTransport();
      sinon.stub(transport, 'connect', function() {
        // will not call the callback, leaving the state machine in the 'CONNECTING' state
      });

      var client = new Client(transport);
      client.open();
      client.close(testCallback);
    });
  });

  ['sendEvent', 'sendEventBatch', 'complete', 'reject', 'abandon'].forEach(function(funcName) {
    describe('#' + funcName, function() {
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_052: [The `sendEventBatch` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_048: [The `sendEvent` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_068: [The `complete` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_072: [The `reject` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_076: [The `abandon` method shall automatically connect the transport if necessary.]*/
      it('calls connect on the transport if disconnected', function(testCallback) {
        var transport = new FakeTransport();
        sinon.spy(transport, 'connect');

        var client = new Client(transport);
        client[funcName]('testMessage', function(err) {
          if (err) {
            testCallback(err);
          } else {
            assert(transport.connect.called);
            testCallback();
          }
        });
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_053: [If the transport fails to connect, the `sendEventBatch` method shall call the `sendEventBatchCallback` method with the error returned while trying to connect.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_049: [If the transport fails to connect, the `sendEvent` method shall call the `sendEventCallback` method with the error returned while trying to connect.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_069: [If the transport fails to connect, the `complete` method shall call the `completeCallback` method with the error returned while trying to connect.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_073: [If the transport fails to connect, the `reject` method shall call the `rejectCallback` method with the error returned while trying to connect.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_077: [If the transport fails to connect, the `abandon` method shall call the `abandonCallback` method with the error returned while trying to connect.]*/
      it('calls its callback with an error if connecting the transport fails', function(testCallback) {
        var openErr = new errors.UnauthorizedError();
        var transport = new FakeTransport();
        sinon.stub(transport, 'connect', function(callback) {
          callback(openErr);
        });

        var client = new Client(transport);
        client[funcName]('testMessage', function(err) {
          assert.strictEqual(err, openErr);
          testCallback();
        });
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_052: [The `sendEventBatch` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_048: [The `sendEvent` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_068: [The `complete` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_072: [The `reject` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_076: [The `abandon` method shall automatically connect the transport if necessary.]*/
      it('doesn\'t call connect on the transport if it\'s already connected', function(testCallback) {
        var transport = new FakeTransport();
        sinon.spy(transport, 'connect');

        var client = new Client(transport);
        client.open(function() {
        assert(transport.connect.calledOnce);
          client[funcName]('testMessage', function(err) {
            assert(transport.connect.calledOnce);
            testCallback(err);
          });
        });
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_052: [The `sendEventBatch` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_048: [The `sendEvent` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_068: [The `complete` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_072: [The `reject` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_076: [The `abandon` method shall automatically connect the transport if necessary.]*/
      it('Waits to be connected to send the message if called while connecting', function(testCallback) {
        var transport = new FakeTransport();
        sinon.stub(transport, 'connect', function(openCallback) {
          // will not call the callback, leaving the state machine in a "CONNECTING" status.
          transport._openCallback = openCallback;
        });

        var unblockOpen = function() {
          transport._openCallback(null, new results.Connected()); // unblock the state machine from the 'connecting' state
        };

        var client = new Client(transport);
        client.open();
        client[funcName]('message', testCallback);
        unblockOpen();
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_052: [The `sendEventBatch` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_048: [The `sendEvent` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_068: [The `complete` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_072: [The `reject` method shall automatically connect the transport if necessary.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_076: [The `abandon` method shall automatically connect the transport if necessary.]*/
      it('Waits to be connected to send the message if called while updating the shared access signature', function(testCallback) {
        var transport = new FakeTransport();
        sinon.stub(transport, 'updateSharedAccessSignature', function(sas, updateSasCallback) {
          transport._updateSasCallback = updateSasCallback; // will store the callback but not call it, blocking the state machine in the 'updating_sas' state.
        });

        var unblockUpdateSas = function() {
          transport._updateSasCallback(null, new results.SharedAccessSignatureUpdated(true));
        };

        sinon.stub(transport, funcName).callsArgWith(1, null, new results.MessageEnqueued());

        var client = new Client(transport);
        client.blobUploadClient = { updateSharedAccessSignature: function() {} };
        client.open(function() {
          client.updateSharedAccessSignature('newsas');
          client[funcName]('message', testCallback);
          unblockUpdateSas();
        });
      });

      it('Waits to be disconnected to reconnect and send the message if called while closing the client', function(testCallback) {
        var transport = new FakeTransport();
        sinon.stub(transport, 'disconnect', function(disconnectCallback) {
          transport._disconnectCallback = disconnectCallback; // will store the callback but not call it, blocking the state machine in the 'disconnecting' state.
        });

        var unblockDisconnect = function() {
          transport._disconnectCallback(null, new results.Disconnected()); // unblocks the state machine from the 'disconnecting' state.
        };

        var client = new Client(transport);
        client.open(function() {
          client.close();
          client[funcName]('message', testCallback);
          unblockDisconnect();
        });
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_051: [The `sendEventBatch` method shall not throw if the `sendEventBatchCallback` is not passed.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_047: [The `sendEvent` method shall not throw if the `sendEventCallback` is not passed.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_067: [The `complete` method shall not throw if the `completeCallback` is not passed.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_071: [The `reject` method shall not throw if the `rejectCallback` is not passed.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_075: [The `abandon` method shall not throw if the `abandonCallback` is not passed.]*/
      it('doesn\'t throw if no callback is given and the method exists on the transport', function() {
        var transport = new FakeTransport();
        var client = new Client(transport);
        client.open(function() {
          assert.doesNotThrow(function() {
            client[funcName]('message');
          });
        });
      });

      /*Tests_SRS_NODE_DEVICE_CLIENT_16_081: [The `sendEvent` method shall throw a `NotImplementedError` if the transport doesn't have that feature.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_082: [The `sendEventBatch` method shall throw a `NotImplementedError` if the transport doesn't have that feature.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_078: [The `complete` method shall throw a `NotImplementedError` if the transport doesn't have that feature.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_079: [The `reject` method shall throw a `NotImplementedError` if the transport doesn't have that feature.]*/
      /*Tests_SRS_NODE_DEVICE_CLIENT_16_080: [The `abandon` method shall throw a `NotImplementedError` if the transport doesn't have that feature.]*/
      it('throws if the method doesn\'t exist on the transport', function() {
        var transport = new FakeTransport();
        delete transport[funcName];

        var client = new Client(transport);
        client.open(function() {
          assert.throws(function() {
            client[funcName]('message');
          }, errors.NotImplementedError);
        });
      });
    });
  });

  describe('#onDeviceMethod', function() {
    var MockReceiver = function() {
      EventEmitter.call(this);

      this.onDeviceMethod = function(methodName, callback) {
        this.on('method_' + methodName, callback);
      };

      // causes a mock method event to be raised
      this.emitMethodCall = function(methodName) {
        this.emit('method_' + methodName, {
          methods: { methodName: methodName },
          body: JSON.stringify(''),
          requestId: '42'
        });
      };

      this.emitErrorReceived = function(err) {
        this.emit('errorReceived', err);
      };
    };
    util.inherits(MockReceiver, EventEmitter);

    var MockTransport = function(config) {
      EventEmitter.call(this);
      this.config = config;
      this.receiver = new MockReceiver();

      this.getReceiver = function(callback) {
        callback(null, this.receiver);
      };

      this.sendMethodResponse = function(response, done) {
        response = response;
        if(!!done && typeof(done) === 'function') {
          done(null);
        }
      };
    };
    util.inherits(MockTransport, EventEmitter);

    // Tests_SRS_NODE_DEVICE_CLIENT_13_020: [ onDeviceMethod shall throw a ReferenceError if methodName is falsy. ]
    [undefined, null].forEach(function (methodName) {
      it('throws ReferenceError when methodName is "' + methodName + '"', function() {
        var transport = new MockTransport();
        var client = new Client(transport);
        assert.throws(function() {
          client.onDeviceMethod(methodName, function() {});
        }, ReferenceError);
      });
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_024: [ onDeviceMethod shall throw a TypeError if methodName is not a string. ]
    [new Date(), 42].forEach(function (methodName) {
      it('throws TypeError when methodName is "' + methodName + '"', function() {
        var transport = new MockTransport();
        var client = new Client(transport);
        assert.throws(function() {
          client.onDeviceMethod(methodName, function() {});
        }, TypeError);
      });
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_022: [ onDeviceMethod shall throw a ReferenceError if callback is falsy. ]
    [undefined, null].forEach(function (callback) {
      it('throws ReferenceError when callback is "' + callback + '"', function() {
        var transport = new MockTransport();
        var client = new Client(transport);
        assert.throws(function() {
          client.onDeviceMethod('doSomeTests', callback);
        }, ReferenceError);
      });
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_025: [ onDeviceMethod shall throw a TypeError if callback is not a Function. ]
    ['not_a_function', 42].forEach(function (callback) {
      it('throws ReferenceError when callback is "' + callback + '"', function() {
        var transport = new MockTransport();
        var client = new Client(transport);
        assert.throws(function() {
          client.onDeviceMethod('doSomeTests', callback);
        }, TypeError);
      });
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_001: [ The onDeviceMethod method shall cause the callback function to be invoked when a cloud-to-device method invocation signal is received from the IoT Hub service. ]
    it('calls callback when C2D method call arrives when subscribed from a disconnected state', function(done) {
      // setup
      var transport = new MockTransport();
      var client = new Client(transport);
      client.onDeviceMethod('reboot', function() {
        done();
      });

      // test
      transport.receiver.emitMethodCall('reboot');
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_001: [ The onDeviceMethod method shall cause the callback function to be invoked when a cloud-to-device method invocation signal is received from the IoT Hub service. ]
    it('calls callback when C2D method call arrives when subscribed from a connected state', function(done) {
      // setup
      var transport = new MockTransport();
      var client = new Client(transport);
      client.open(function() {
        client.onDeviceMethod('firstMethod', function() {}); // This will connect the method receiver
        client.onDeviceMethod('reboot', function() {
          done();
        });
      });

      // test
      transport.receiver.emitMethodCall('reboot');
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_006: [The ‘error’ event shall be emitted when an error occurred within the client code.] */
    it('emits an error event when it cannot connect the transport', function(testCallback) {
      // setup
      var fakeError = new Error('could not open');
      var transport = {
        connect: function(openCallback) {
          openCallback(fakeError);
        },
        sendMethodResponse: function() {},
        removeListener: function() {},
        on: function() {}
      };
      var client = new Client(transport);
      client.on('error', function(err) {
        assert.strictEqual(err, fakeError);
        testCallback();
      });
      client.onDeviceMethod('reboot', function() {});
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_006: [The ‘error’ event shall be emitted when an error occurred within the client code.] */
    it('emits an error event when the receiver emits an errorReceived event', function(testCallback) {
      // setup
      var transport = new MockTransport();
      var fakeError = new Error('fake error');
      var client = new Client(transport);
      client.on('error', function(err) {
        assert.strictEqual(err, fakeError);
        testCallback();
      });

      client.onDeviceMethod('reboot', function() {});

      // test
      transport.receiver.emitErrorReceived(fakeError);
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_003: [ The client shall start listening for method calls from the service whenever there is a listener subscribed for a method callback. ]
    it('registers callback on transport when a method event is subscribed to', function() {
      // setup
      var transport = new MockTransport();
      var client = new Client(transport);
      var callback = sinon.spy();
      transport.receiver.on('newListener', callback);

      // test
      client.onDeviceMethod('reboot', function(){});

      // assert
      assert.isTrue(callback.withArgs('method_reboot').calledOnce);

      // cleanup
      transport.receiver.removeListener('newListener', callback);
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_023: [ onDeviceMethod shall throw an Error if a listener is already subscribed for a given method call. ]
    it('throws if a listener is already subscribed for a method call', function() {
      // setup
      var transport = new MockTransport();
      var client = new Client(transport);
      client.onDeviceMethod('reboot', function(){});

      // test
      // assert
      assert.throws(function() {
        client.onDeviceMethod('reboot', function(){});
      });
    });

    // Tests_SRS_NODE_DEVICE_CLIENT_13_021: [ onDeviceMethod shall throw an Error if the underlying transport does not support device methods. ]
    it('throws if underlying transport does not support device methods', function() {
      // setup
      var transport = new FakeTransport();
      var client = new Client(transport);

      // test & assert
      assert.throws(function() {
        client.onDeviceMethod('reboot', function() {});
      });
    });
  });

  describe('#events', function () {
    /*Tests_SRS_NODE_DEVICE_CLIENT_16_002: [The ‘message’ event shall be emitted when a cloud-to-device message is received from the IoT Hub service.]*/
    it('emits a message event when a message is received', function (done) {
      var DummyReceiver = function () {
        EventEmitter.call(this);
        this.emitMessage = function (msg) {
          process.nextTick(function() {
            this.emit('message', msg);
          }.bind(this));
        };
      };
      util.inherits(DummyReceiver, EventEmitter);

      var receiver = new DummyReceiver();
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });
      var client = new Client(dummyTransport);
      client.on('message', function (msg) {
        /*Tests_SRS_NODE_DEVICE_CLIENT_16_003: [The ‘message’ event parameter shall be a ‘Message’ object.]*/
        assert.equal(msg.constructor.name, 'Message');
        done();
      });

      receiver.emitMessage(new Message());
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_004: [The client shall start listening for messages from the service whenever there is a listener subscribed to the ‘message’ event.]*/
    it('starts listening for messages when a listener subscribes to the message event', function (testCallback) {
      var receiver = new EventEmitter();
      sinon.stub(receiver, 'on', function(evt) {
        if(evt !== 'errorReceived') {
          assert.strictEqual(evt, 'message');
          testCallback();
        }
      });

      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });
      var client = new Client(dummyTransport);

      // Calling 'on' twice to make sure it's called only once on the receiver.
      // It works because the test will fail if the test callback is called multiple times, and it's called for every time the 'message' event is subscribed on the receiver.
      client.on('message', function () { });
      client.on('message', function () { });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_005: [The client shall stop listening for messages from the service whenever the last listener unsubscribes from the ‘message’ event.]*/
    it('stops listening for messages when the last listener has unsubscribed', function (testCallback) {
      var receiver = new EventEmitter();
      sinon.spy(receiver, 'removeAllListeners');

      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function (callback) {
        callback(null, receiver);
      });

      var client = new Client(dummyTransport);
      var listener1 = function () { };
      var listener2 = function () { };
      client.on('message', listener1);
      client.on('message', listener2);

      process.nextTick(function() {
        client.removeListener('message', listener1);
        assert.isFalse(receiver.removeAllListeners.called);
        client.removeListener('message', listener2);
        assert(receiver.removeAllListeners.calledOnce);
        testCallback();
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_065: [The client shall connect the transport if needed to subscribe receive messages.]*/
    it('receives messages after renewing the SAS if the event handler is registered while updating the SAS', function(testCallback) {
      var receiver = new EventEmitter();
      var dummyTransport = new FakeTransport();

      sinon.stub(dummyTransport, 'getReceiver', function (callback) {
        callback(null, receiver);
      });

      sinon.stub(dummyTransport, 'connect', function(callback) {
        /* The process of reconnecting after updating the shared access signature
          * later in the test should take long enough for the on('message') call
          * to hit the 'UPDATING_SAS' state of the state machine. 2 ticks is the minimum.
          */
        process.nextTick(function() {
          process.nextTick(function() {
            callback(null, new results.Connected());
          });
        });
      });

      sinon.stub(dummyTransport, 'updateSharedAccessSignature', function(newSas, callback) {
        callback(null, new results.SharedAccessSignatureUpdated(true));
      });

      var client = new Client(dummyTransport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };
      client.open(function() {
        client.updateSharedAccessSignature('newSas', function() {
          // at that point the transport has reconnected, and the receiver should be reconnected too.
          process.nextTick(function() {
            receiver.emit('message', new Message());
          });
        });

        client.on('message', function () {
          testCallback();
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_065: [The client shall connect the transport if needed to subscribe receive messages.]*/
    it('receives messages if the event handler is registered while connecting', function(testCallback) {
      var receiver = new EventEmitter();
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });
      sinon.stub(dummyTransport, 'connect', function(callback) {
        process.nextTick(function() {
          process.nextTick(function() {
            callback(null, new results.Connected());
          });
        });
      });

      var client = new Client(dummyTransport);
      client.open(function(){
        receiver.emit('message', new Message());
      });

      client.on('message', function () {
        testCallback();
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_065: [The client shall connect the transport if needed to subscribe receive messages.]*/
    it('receives messages if the event handler is registered while already connected', function(testCallback) {
      var receiver = new EventEmitter();
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });

      var client = new Client(dummyTransport);
      client.open(function(){
        client.on('message', function () {
          testCallback();
        });

        process.nextTick(function() {
          receiver.emit('message', new Message());
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_066: [The client shall emit an error if connecting the transport fails while subscribing to message events.]*/
    it('emits an error if the transport cannot automatically connect when registering for message events', function(testCallback) {
      var fakeError = new Error('fake error');
      var transport = new FakeTransport();
      sinon.stub(transport, 'connect', function(callback) {
        callback(fakeError);
      });

      var client = new Client(transport);
      client.on('error', function(err) {
        assert.equal(err, fakeError);
        testCallback();
      });

      client.on('message', function() {});
    });

    it('correctly starts the message receiver even if device methods have been registered', function(testCallback) {
      var receiver = new EventEmitter();
      receiver.onDeviceMethod = sinon.spy();
      sinon.stub(receiver, 'on', function(evt) {
        if (evt === 'message') {
          testCallback();
        }
      });

      var transport = new FakeTransport();
      transport.sendMethodResponse = function() {};
      sinon.stub(transport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });

      var client = new Client(transport);
      client.onDeviceMethod('testMethod', function() {});
      assert.isTrue(receiver.onDeviceMethod.calledWith('testMethod'));
      assert.isFalse(receiver.on.calledWith('message'));
      client.on('message', function() {});
    });

    it('correctly starts the method receiver even if the message receiver has already been registered', function(testCallback) {
      var testMethodName = 'methodName';
      var receiver = new EventEmitter();
      receiver.onDeviceMethod = function(methodName) {
        assert.isTrue(receiver.on.calledWith('message'));
        assert.strictEqual(methodName, testMethodName);
        testCallback();
      };
      sinon.spy(receiver, 'on');

      var transport = new FakeTransport();
      transport.sendMethodResponse = function() {};
      sinon.stub(transport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });

      var client = new Client(transport);
      client.on('message', function() { });
      client.onDeviceMethod(testMethodName, function() {});
    });
  });

  [
    { methodName: 'complete', expectedResultCtor: 'MessageCompleted' },
    { methodName: 'reject', expectedResultCtor: 'MessageRejected' },
    { methodName: 'abandon', expectedResultCtor: 'MessageAbandoned' }
  ].forEach(function(testConfig) {
    describe('#' + testConfig.methodName, function () {
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_016: [The ‘complete’ method shall throw a ReferenceError if the ‘message’ parameter is falsy.] */
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_018: [The ‘reject’ method shall throw a ReferenceError if the ‘message’ parameter is falsy.] */
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_017: [The ‘abandon’ method shall throw a ReferenceError if the ‘message’ parameter is falsy.] */
      [undefined, null, '', 0].forEach(function (message) {
        it('throws if message is \'' + message + '\'', function () {
          var client = new Client(new FakeTransport());
          assert.throws(function () {
            client[testConfig.methodName](message, function () { });
          }, ReferenceError);
        });
      });

      /*Codes_SRS_NODE_DEVICE_CLIENT_16_007: [The ‘complete’ method shall call the ‘complete’ method of the transport with the message as an argument]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_010: [The ‘reject’ method shall call the ‘reject’ method of the transport with the message as an argument]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_013: [The ‘abandon’ method shall call the ‘abandon’ method of the transport with the message as an argument]*/
      it('calls the ' + testConfig.methodName + ' method on the transport with the message as an argument', function () {
        var dummyTransport = new FakeTransport();
        sinon.spy(dummyTransport, testConfig.methodName);

        var client = new Client(dummyTransport);
        var message = new Message();
        client[testConfig.methodName](message, function () { });
        assert(client._transport[testConfig.methodName].calledOnce);
        assert(client._transport[testConfig.methodName].calledWith(message));
      });

      /*Codes_SRS_NODE_DEVICE_CLIENT_16_008: [The ‘done’ callback shall be called with a null error object and a ‘MessageCompleted’ result once the transport has completed the message.]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_011: [The ‘done’ callback shall be called with a null error object and a ‘MessageRejected’ result once the transport has rejected the message.]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_014: [The ‘done’ callback shall be called with a null error object and a ‘Messageabandoned’ result once the transport has abandoned the message.]*/
      it('calls the done callback with a null error object and a result', function (done) {
        var client = new Client(new FakeTransport());
        var message = new Message();
        client[testConfig.methodName](message, function (err, res) {
          if (err) {
            done(err);
          } else {
            assert.equal(res.constructor.name, testConfig.expectedResultCtor);
            done();
          }
        });
      });

      /*Codes_SRS_NODE_DEVICE_CLIENT_16_009: [The ‘done’ callback shall be called with a standard javascript Error object and no result object if the transport could not complete the message.]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_012: [The ‘done’ callback shall be called with a standard javascript Error object and no result object if the transport could not reject the message.]*/
      /*Codes_SRS_NODE_DEVICE_CLIENT_16_015: [The ‘done’ callback shall be called with a standard javascript Error object and no result object if the transport could not abandon the message.]*/
      it('calls the done callback with an error if the transport fails to complete the message', function (done) {
        var testError = new Error('fake error');
        var dummyTransport = new FakeTransport();
        sinon.stub(dummyTransport, [testConfig.methodName], function (message, callback) {
          callback(testError);
        });

        var client = new Client(dummyTransport);
        var message = new Message();
        client[testConfig.methodName](message, function (err) {
          assert.strictEqual(err, testError);
          done();
        });
      });
    });
  });

  describe('#updateSharedAccessSignature', function () {
    var DummyBlobUploadClient = function() {};
    DummyBlobUploadClient.prototype.updateSharedAccessSignature = function() {};

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_031: [The updateSharedAccessSignature method shall throw a ReferenceError if the sharedAccessSignature parameter is falsy.]*/
    [undefined, null, '', 0].forEach(function (sas) {
      it('throws a ReferenceError if sharedAccessSignature is \'' + sas + '\'', function () {
        var client = new Client(new FakeTransport());
        assert.throws(function () {
          client.updateSharedAccessSignature(sas, function () { });
        }, ReferenceError);
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_06_002: [The `updateSharedAccessSignature` method shall throw a `ReferenceError` if the client was created using x509.]*/
    it('throws a ReferenceError if client created using x509', function () {
      var client = new Client(new FakeTransport(), 'HostName=host;DeviceId=id;x509=true');
      assert.throws(function () {
        client.updateSharedAccessSignature('sas', function () { });
      }, ReferenceError);
    });


    /*Tests_SRS_NODE_DEVICE_CLIENT_16_032: [The updateSharedAccessSignature method shall call the updateSharedAccessSignature method of the transport currently in use with the sharedAccessSignature parameter.]*/
    it('calls the transport `updateSharedAccessSignature` method with the sharedAccessSignature parameter', function () {
      var dummyTransport = new FakeTransport();
      sinon.spy(dummyTransport, 'updateSharedAccessSignature');

      var client = new Client(dummyTransport, null, new DummyBlobUploadClient());
      var sas = 'sas';
      client.updateSharedAccessSignature(sas, function () { });
      assert(dummyTransport.updateSharedAccessSignature.calledOnce);
      assert(dummyTransport.updateSharedAccessSignature.calledWith(sas));
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_033: [The updateSharedAccessSignature method shall reconnect the transport to the IoTHub service if it was connected before before the method is called.]*/
    it('Reconnects the transport and receiver if necessary', function (done) {
      var dummyTransport = new FakeTransport();
      var receiver = new EventEmitter();
      sinon.stub(dummyTransport, 'updateSharedAccessSignature', function (sas, callback) {
        callback(null, new results.SharedAccessSignatureUpdated(true));
      });
      sinon.spy(dummyTransport, 'connect');
      sinon.stub(dummyTransport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });

      var client = new Client(dummyTransport, null, new DummyBlobUploadClient());
      client.on('message', function () {
        done();
      });

      client.open(function() {
        client.updateSharedAccessSignature('sas', function (err, res) {
          if (err) {
            done(err);
          } else {
            assert.isFalse(res.needToReconnect);
            assert.isTrue(dummyTransport.connect.called);
            assert.isTrue(dummyTransport.getReceiver.called);
            receiver.emit('message', new Message(''));
          }
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_034: [The `updateSharedAccessSignature` method shall not reconnect when the 'needToReconnect' property of the result argument of the callback is false.]*/
    it('Doesn\'t reconnect the transport if it\'s not necessary', function (done) {
      var dummyTransport = new FakeTransport();
      sinon.spy(dummyTransport, 'connect');

      var client = new Client(dummyTransport, null, new DummyBlobUploadClient());
      client.updateSharedAccessSignature('sas', function (err, res) {
        if (err) {
          done(err);
        } else {
          assert.isFalse(res.needToReconnect);
          assert.isFalse(dummyTransport.connect.called);
          done();
        }
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_035: [The updateSharedAccessSignature method shall call the `done` callback with an error object if an error happened while renewing the token.]*/
    it('Calls the `done` callback with an error object if an error happened', function (done) {
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'updateSharedAccessSignature', function (sas, callback) {
        callback(new Error('foo'));
      });

      var client = new Client(dummyTransport, null, new DummyBlobUploadClient());
      client.updateSharedAccessSignature('sas', function (err) {
        assert.isOk(err);
        done();
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_036: [The updateSharedAccessSignature method shall call the `done` callback with a null error object and a result of type SharedAccessSignatureUpdated if the token was updated successfully.]*/
    it('Calls the `done` callback with a null error object and a SharedAccessSignatureUpdated result', function (done) {
      var client = new Client(new FakeTransport(), null, new DummyBlobUploadClient());
      client.updateSharedAccessSignature('sas', function (err, res) {
        if (err) {
          done(err);
        } else {
          assert.equal(res.constructor.name, 'SharedAccessSignatureUpdated');
          done();
        }
      });
    });

    it('should be deferred until connected if called while connecting', function(testCallback){
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'connect', function(openCallback) {
         // will not call the callback, leaving the state machine in a "CONNECTING" status.
        dummyTransport._openCallback = openCallback;
      });

      var unblockOpen = function() {
        dummyTransport._openCallback(null, new results.Connected());
      };

      var client = new Client(dummyTransport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };
      client.open();
      client.updateSharedAccessSignature('newSas', testCallback);
      unblockOpen();
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_035: [The `updateSharedAccessSignature` method shall call the `done` callback with an error object if an error happened while renewing the token.]*/
    it('should call its callback with an error if it the transport fails to update the shared access signature', function(testCallback){
      var dummyTransport = new FakeTransport();
      sinon.stub(dummyTransport, 'updateSharedAccessSignature', function(sas, callback) {
        callback(new Error('failed to reconnect'));
      });

      var client = new Client(dummyTransport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };
      client.open(function() {
        client.updateSharedAccessSignature('newSas', function (err) {
          assert.instanceOf(err, Error);
          testCallback();
        });
      });
    });

    /*Tests_SRS_NODE_DEVICE_CLIENT_16_035: [The `updateSharedAccessSignature` method shall call the `done` callback with an error object if an error happened while renewing the token.]*/
    it('should call its callback with an error if it the transport fails to reconnect', function(testCallback){
      var calledOnce = false;
      var transport = new FakeTransport();

      sinon.stub(transport, 'connect', function(callback) {
        if (!calledOnce) {
          calledOnce = true;
          callback(null, new results.Connected());
        } else {
          callback(new Error('failed to reconnect'));
        }
      });

      sinon.stub(transport, 'updateSharedAccessSignature', function(sas, callback) {
        callback(null, new results.SharedAccessSignatureUpdated(true));
      });

      var client = new Client(transport);
      client.blobUploadClient = { updateSharedAccessSignature: function() {} };
      client.open(function() {
        client.updateSharedAccessSignature('newSas', function (err) {
          assert.instanceOf(err, Error);
          testCallback();
        });
      });
    });

    it('reconnects the device method callbacks after updating the shared access signature', function(testCallback) {
      var receiver = new EventEmitter();
      var fakeMethodName = 'fakeMethodName';
      var methodHandlerRegistrationCounter = 0;
      receiver.onDeviceMethod = function(methodName) {
        assert.strictEqual(methodName, fakeMethodName);
        methodHandlerRegistrationCounter++;
        if (methodHandlerRegistrationCounter === 2) {
          testCallback();
        }
      };

      var transport = new FakeTransport();
      transport.sendMethodResponse = function() {};
      sinon.stub(transport, 'getReceiver', function(callback) {
        callback(null, receiver);
      });

      var client = new Client(transport, null, { updateSharedAccessSignature: function() {} });
      client.onDeviceMethod(fakeMethodName, function() { });
      client.updateSharedAccessSignature('newSas', function() { });
    });
  });

  describe('getTwin', function() {
    it('creates the device twin correctly', function(done) {
      var client = new Client(new FakeTransport());

      /* Tests_SRS_NODE_DEVICE_CLIENT_18_001: [** The `getTwin` method shall call the `azure-iot-device-core!Twin.fromDeviceClient` method to create the device client object. **]** */
      var fakeTwin = {
        fromDeviceClient: function(obj, innerDone) {
          /* Tests_SRS_NODE_DEVICE_CLIENT_18_002: [** The `getTwin` method shall pass itself as the first parameter to `fromDeviceClient` and it shall pass the `done` method as the second parameter. **]**  */
          assert.equal(obj, client);
          assert.equal(innerDone, done);
          done();
        }
      };

      /* Tests_SRS_NODE_DEVICE_CLIENT_18_003: [** The `getTwin` method shall use the second parameter (if it is not falsy) to call `fromDeviceClient` on. **]**    */
     client.getTwin(done, fakeTwin);
    });

    it('calls the callback with an error if connecting the transport fails', function(testCallback) {
      var fakeError = new Error('fake error');
      var transport = new FakeTransport();
      sinon.stub(transport, 'connect', function(callback) {
        callback(fakeError);
      });

      var client = new Client(transport)
      client.getTwin(function(err) {
        assert.strictEqual(err, fakeError);
        testCallback();
      });
    });
  });
});

describe('Over simulated HTTPS', function () {
  var registry = {
    create: function(deviceId, done) {
      done(null, {
        deviceId: deviceId,
        authentication: {
          symmetricKey: {
            primaryKey: 'key=='
          }
        }
      });
    },
    delete: function(deviceId, done) { done(); }
  };

  clientTests.sendEventTests(SimulatedHttp, registry);
  clientTests.sendEventBatchTests(SimulatedHttp, registry);
});
