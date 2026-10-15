import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const version = '0.0.1-alpha.43-node';
// The upstream CommonJS client barrel eagerly loads native BLE even for serial.
// Replace only that facade in the distribution, preserving serial/packet code.
// Base exports precede node_serial_impl because the upstream code has a cycle.
const serialFacade = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base = require("./abstract_client");
exports.NiimbotAbstractClient = base.NiimbotAbstractClient;
exports.NIIMBOT_CLIENT_DEFAULTS = base.NIIMBOT_CLIENT_DEFAULTS;
const serial = require("./node_serial_impl");
exports.NiimbotNodeSerialClient = serial.NiimbotNodeSerialClient;
exports.instantiateClient = transport => {
  if (transport !== "node-serial") throw new Error("This WTS distribution supports USB serial only");
  return new serial.NiimbotNodeSerialClient();
};
`;

export function vendorSerialLibrary(stage) {
 const source = dirname(dirname(dirname(require.resolve('@mmote/niimbluelib'))));
 const original = JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
 if(original.name !== '@mmote/niimbluelib' || original.version !== version) throw new Error('USB-only facade needs review for changed upstream version');
 const barrel = readFileSync(join(source,'dist/cjs/client/index.js'),'utf8');
 if(!barrel.includes('require("./node_ble_impl")') || !barrel.includes('require("./node_serial_impl")')) throw new Error('Unexpected upstream client facade');
 const target=join(stage,'vendor/niimbluelib');mkdirSync(target,{recursive:true});
 cpSync(join(source,'dist/cjs'),join(target,'dist/cjs'),{recursive:true});
 const manifest={name:original.name,version:original.version,description:'Pinned upstream NIIMBOT protocol with WTS USB-only client facade',main:'dist/cjs/index.js',types:'dist/cjs/index.d.ts',license:original.license,repository:original.repository,dependencies:Object.fromEntries(['@capacitor/core','async-mutex','crc-32','eventemitter3','serialport'].map(name=>{if(!original.dependencies[name])throw new Error('Missing serial dependency');return [name,original.dependencies[name]];}))};
 writeFileSync(join(target,'package.json'),JSON.stringify(manifest,null,2)+'\n');
 writeFileSync(join(target,'dist/cjs/client/index.js'),serialFacade);
 cpSync(join(source,'LICENSE'),join(target,'LICENSE'));
 const provenance={upstream:original.repository,version,modified:['dist/cjs/client/index.js','package.json'],originalFacadeSha256:createHash('sha256').update(barrel).digest('hex'),purpose:'USB-only distribution; serial protocol and print implementation unchanged'};
 writeFileSync(join(target,'WTS-SERIAL-ONLY.json'),JSON.stringify(provenance,null,2)+'\n');
 return 'file:vendor/niimbluelib';
}
