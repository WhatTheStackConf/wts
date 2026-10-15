import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { verifyOpenedPrinter } from '../.output/checkin-runtime/runtime/checkin/printer-identification.js';

void test('unknown or mismatched opened-printer serial fails closed',async()=>{
 await verifyOpenedPrinter({abstraction:{getPrinterSerialNumber:async()=> 'ACTUAL-A'}},'ACTUAL-A');
 await assert.rejects(verifyOpenedPrinter({abstraction:{getPrinterSerialNumber:async()=> 'ACTUAL-B'}},'ACTUAL-A'),{category:'printer_identity_mismatch'});
 await assert.rejects(verifyOpenedPrinter({abstraction:{getPrinterSerialNumber:async()=>{throw new Error('timeout');}}},'ACTUAL-A'),{category:'printer_identity_unverified'});
});

void test('maintained driver checks the open stream before any print command after a path swap',async t=>{
 const api=createRequire(import.meta.url)('@mmote/niimblue-node/dist/utils.js');
 let connected=0,disconnected=0,printed=0,identityReads=0;
 t.mock.method(api,'initClient',()=>({
  async connect(){connected++;},async disconnect(){disconnected++;},
  getModelMetadata(){return {model:'B1',id:[4096]};},
  abstraction:{async getPrinterSerialNumber(){identityReads++;return 'DIFFERENT-B1';}},
 }));
 t.mock.method(api,'printImages',async()=>{printed++;});
 const {maintainedNiimbotSerialDriver}=await import('../.output/checkin-runtime/runtime/checkin/printer.js');
 await assert.rejects(maintainedNiimbotSerialDriver.print({address:'/dev/ttyACM0',expectedSerial:'ENROLLED-A',model:'B1',density:5,labelType:1,printDirection:'top',pngBase64:'not-read-before-identity',debug:false}),{category:'printer_identity_mismatch'});
 assert.equal(connected,1);assert.equal(identityReads,1);assert.equal(disconnected,1);assert.equal(printed,0);
});
