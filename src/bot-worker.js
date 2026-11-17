import {parentPort,workerData} from 'node:worker_threads';
import {chooseBotMove} from './bot.js';
parentPort.postMessage({type:'sanco-bot-move',move:chooseBotMove(workerData)});
