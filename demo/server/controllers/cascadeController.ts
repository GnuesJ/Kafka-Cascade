const { Kafka } = require('kafkajs');
const cascade = require('../../../kafka-cascade/index.ts');
import * as Cascade from '../../../kafka-cascade/index';
import {Types as cascadeType} from '../../../kafka-cascade/index';
import CascadeService from '../../../kafka-cascade/src/cascadeService';

const kafka = new Kafka({
  clientId: 'kafka-demo',
  brokers: ['localhost:9092'],
});

const producer = kafka.producer();  

let topic = 'test-topic';
const groupId = 'test-group';
const serviceCB:Cascade.Types.ServiceCallback = (msg, resolve, reject) => {
  const message = JSON.parse(msg.message.value);
  const header = JSON.parse(msg.message.headers.cascadeMetadata);

  if(header.retries === message.retries) resolve(msg);
  else reject(msg);
};
const successCB:Cascade.Types.RouteCallback = (msg) => {
  const retries = JSON.parse(msg.message.headers.cascadeMetadata).retries
  console.log('Received message in success callback: ' + retries);
};
const dlqCB:Cascade.Types.RouteCallback = (msg) => {
  console.log('Received message in DLQ');
};

var service: Cascade.CascadeService;

const cascadeController:any = {};

cascadeController.startService = async (req: {query: {retries:string}}, res, next) => {
  try {
    const { retries } = req.query;
    await producer.connect();
    service = await cascade.service(kafka, topic, groupId, serviceCB, successCB, dlqCB);
    console.log('Connected to Kafka server...');
    service.setRetryLevels(6);
    await service.run();
    console.log('Listening to Kafka server...');

    // what do we send back?
    res.locals.confirmation = 'Cascade service connected to Kafka server...';
    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.startService: ' + error,
      message: 'Error in cascadeController.startService, check the log',
    });
  }
};

cascadeController.sendMessage = async (req, res, next) => {
  try {
    topic = req.query.topic || topic;
    const message = req.query.message || 'https://www.youtube.com/watch?v=fNLhxKpfCnA';
    let retries = req.query.retries;

    res.locals = { message, retries: Number(retries), time: (new Date()).valueOf() };

    // check to see if server is running

    // send message
    await producer.send({
      topic,
      messages: [
        {
          value: JSON.stringify(res.locals),
        }
      ]
    })
    
    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.sendMessage: ' + error,
      message: 'Error in cascadeController.sendMessage, check the log',
    });
  }
};

cascadeController.stopService = async (req, res, next) => {
  try {
    await producer.disconnect();
    // nothing else to do yet
    return next();
  }
  catch(error) {
    return next({
      log: 'Error in cascadeController.stopService: ' + error,
      message: 'Error in cascadeController.stopService, check the log',
    });
  }
};


export default cascadeController;