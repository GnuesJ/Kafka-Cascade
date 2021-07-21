"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const EventEmitter = require('events');
const cascadeProducer_1 = require("./cascadeProducer");
const cascadeConsumer_1 = require("./cascadeConsumer");
// kafka object to create producer and consumer
// service callback
// dlq callback -> provide default
// success callback
// topic
// retry producer
// topic consumer
// retry levels -> provide default
// retry strategies per level
/**
 * CascadeService
 */
class CascadeService extends EventEmitter {
    /**
     * CascadeService objects should be constructed from [cascade.service]{@link module:cascade.service}
     */
    constructor(kafka, topic, groupId, serviceCB, successCB, dlqCB) {
        super();
        this.events = [
            'connect',
            'disconnect',
            'run',
            'stop',
            'pause',
            'resume',
            'receive',
            'success',
            'retry',
            'dlq',
            'error',
            'serviceError',
        ];
        this.kafka = kafka;
        this.topic = topic;
        this.serviceCB = serviceCB;
        this.successCB = successCB;
        this.dlqCB = dlqCB;
        this.retries = 0;
        this.topicsArr = [];
        // create producers and consumers
        this.producer = new cascadeProducer_1.default(kafka, topic, dlqCB);
        this.producer.on('retry', (msg) => this.emit('retry', msg));
        this.producer.on('dlq', (msg) => this.emit('dlq', msg));
        this.producer.on('error', (error) => this.emit('error', 'Error in cascade producer: ' + error));
        this.consumer = new cascadeConsumer_1.default(kafka, topic, groupId, false);
        this.consumer.on('receive', (msg) => this.emit('receive', msg));
        this.consumer.on('serviceError', (error) => this.emit('serviceError', error));
        this.consumer.on('error', (error) => this.emit('error', 'Error in cascade consumer: ' + error));
    }
    /**
     * Connects the service to kafka
     * Emits a 'connect' event
     * @returns {Promise}
     */
    connect() {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.producer.connect();
                yield this.consumer.connect();
                resolve(true);
                this.emit('connect');
            }
            catch (error) {
                reject(error);
                this.emit('error', 'Error in cascade.connect(): ' + error);
            }
        }));
    }
    /**
     * Disconnects the service from kafka
     * Emits a 'disconnect' event
     * @returns {Promise}
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            this.producer.stop()
                .then(() => {
                this.producer.disconnect()
                    .then(() => {
                    this.consumer.disconnect()
                        .then(() => {
                        resolve(true);
                        this.emit('disconnect');
                    })
                        .catch(error => {
                        reject(error);
                        this.emit('error', 'Error in cascade.disconnect(): [CONSUMER]' + error);
                    });
                })
                    .catch(error => {
                    reject(error);
                    this.emit('error', 'Error in cascade.disconnect(): [PRODUCER:DISCONNECT]' + error);
                });
            })
                .catch(error => {
                reject(error);
                this.emit('error', 'Error in cascade.disconnect(): [PRODUCER:STOP]' + error);
            });
        });
    }
    /**
     * Sets the parameters for the default retry route or when an unknown status is provided when the service rejects the message.
     * Levels is the number of times a message can be retried before being sent the DLQ callback.
     * Options can contain timeoutLimit as a number array. For each entry it will determine the delay for the message before it is retried.
     * Options can contain batchLimit as a number array. For each entry it will determine how many messages to wait for at the corresponding retry level before sending all pending messages at once.
     * If options is not provided then the default route is to have a batch limit of 1 for each retry level.
     * If both timeoutLimit and batchLimit are provided then timeoutLimit takes precedence
     * @param {number} levels - number of retry levels before the message is sent to the DLQ
     * @param {object} options - sets the retry strategies of the levels
     * @returns {promise}
     */
    setDefaultRoute(levels, options) {
        return new Promise((resolve, reject) => {
            this.producer.setDefaultRoute(levels, options)
                .then(res => resolve(res))
                .catch(error => {
                reject(error);
                this.emit('error', error);
            });
        });
    }
    /**
     * Sets additional routes for the retry strategies when a status is provided when the message is rejected in the service callback.
     * See 'setDefaultRoute' for a discription of the parameters
     * @param {string} status - status code used to trigger this route
     * @param {number} levels - number of retry levels before the message is sent to the DLQ
     * @param {object} options - sets the retry strategies of the levels
     * @returns {Promise}
     */
    setRoute(status, levels, options) {
        return new Promise((resolve, reject) => {
            this.producer.setRoute(status, levels, options)
                .then(res => resolve(res))
                .catch(error => {
                reject(error);
                this.emit('error', error);
            });
        });
    }
    /**
     * Returns a list of all of the kafka topics that this service has created
     * @returns {string[]}
     */
    getKafkaTopics() {
        let topics = [];
        this.producer.routes.forEach(route => topics = topics.concat(route.topics));
        return topics;
    }
    /**
     * Invokes the server to start listening for messages.
     * Equivalent to consumer.run
     * @returns {Promise}
     */
    run() {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                const status = yield this.consumer.run(this.serviceCB, (...args) => { this.emit('success', ...args); this.successCB(...args); }, (msg, status = '') => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield this.producer.send(msg, status);
                    }
                    catch (error) {
                        this.emit('error', 'Error in cascade producer.send(): ' + error);
                    }
                }));
                resolve(status);
                this.emit('run');
            }
            catch (error) {
                reject(error);
                this.emit('error', 'Error in cascade.run(): ' + error);
            }
        }));
    }
    /**
     * Stops the service, any pending retry messages will be sent to the DLQ
     * @returns {Promise}
     */
    stop() {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.consumer.stop();
                yield this.producer.stop();
                resolve(true);
                this.emit('stop');
            }
            catch (error) {
                reject(error);
                this.emit('error', 'Error in cascade.stop(): ' + error);
            }
        }));
    }
    /**
     * Pauses the service, any messages pending for retries will be held until the service is resumed
     * @returns {Promise}
     */
    pause() {
        return __awaiter(this, void 0, void 0, function* () {
            // check to see if service is already paused
            if (!this.producer.paused) {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield this.consumer.pause();
                        this.producer.pause();
                        resolve(true);
                        this.emit('pause');
                    }
                    catch (error) {
                        reject(error);
                        this.emit('error', 'Error in cascade.pause(): ' + error);
                    }
                }));
            }
            else {
                console.log('cascade.pause() called while service is already paused!');
            }
        });
    }
    /**
     *
     * @returns {boolean}
     */
    paused() {
        // return producer.paused boolean;
        return this.producer.paused;
    }
    /**
     * Resumes the service, any paused retry messages will be retried
     * @returns {Promise}
     */
    resume() {
        return __awaiter(this, void 0, void 0, function* () {
            // check to see if service is paused
            if (this.producer.paused) {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield this.consumer.resume();
                        yield this.producer.resume();
                        resolve(true);
                        this.emit('resume');
                    }
                    catch (error) {
                        reject(error);
                        this.emit('error', 'Error in cascade.resume(): ' + error);
                    }
                }));
            }
            else {
                console.log('cascade.resume() called while service is already running!');
            }
        });
    }
    on(event, callback) {
        if (!this.events.includes(event))
            throw new Error('Unknown event: ' + event);
        super.on(event, callback);
    }
}
exports.default = CascadeService;
