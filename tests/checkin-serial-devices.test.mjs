import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { validSerialDeviceSelector, serialDeviceKey, resolveSerialDevice, listSerialDevices, serialCalloutPath } from "../.output/checkin-runtime/runtime/checkin/serial-devices.js";

const device = { vendorId: "1a86", productId: "7523", serialNumber: "B1-ExactSerial" };
const category = (expected) => (error) => error.name === "AgentError" && error.category === expected;

void test("Darwin dial-in inventory maps to the same callout endpoint without altering USB identity", () => {
  assert.equal(serialCalloutPath("/dev/tty.usbmodemB1_GC06121131", "darwin"), "/dev/cu.usbmodemB1_GC06121131");
  assert.equal(serialCalloutPath("/dev/cu.usbmodem123", "darwin"), "/dev/cu.usbmodem123");
  assert.equal(serialCalloutPath("/dev/ttyACM0", "linux"), "/dev/ttyACM0");
  assert.equal(serialCalloutPath("/dev/tty.usb/../../null", "darwin"), "/dev/tty.usb/../../null");
});

void test("enrolled USB identity normalizes only hex IDs and fences every interface as one physical device", () => {
  const enrolled = validSerialDeviceSelector({ vendorId: "1A86", productId: "7523", serialNumber: " B1-ExactSerial ", interface: "00" });
  assert.deepEqual(enrolled, { vendorId: "1a86", productId: "7523", serialNumber: " B1-ExactSerial ", interface: "00" });
  assert.equal(serialDeviceKey(device), serialDeviceKey({ ...device, vendorId: "1A86", interface: "01" }));
  assert.notEqual(serialDeviceKey(device), serialDeviceKey({ ...device, serialNumber: "b1-exactserial" }));
  assert.notEqual(serialDeviceKey(device), serialDeviceKey({ ...device, serialNumber: " B1-ExactSerial " }));
  for (const invalid of [null, [], {}, { ...device, serialNumber: "" }, { ...device, serialNumber: "  " }, { ...device, serialNumber: "abc\0" }, { ...device, vendorId: "g123" }, { ...device, vendorId: "1a86\n" }, { ...device, productId: "12345" }, { ...device, interface: "" }, { ...device, address: "/tmp/not-a-printer" }]) {
    assert.throws(() => validSerialDeviceSelector(invalid), category("invalid_config"));
  }
});

void test("selection follows exact USB identity across native port names and enumeration order", () => {
  const other = { ...device, serialNumber: "OTHER", path: "/dev/ttyACM0" };
  assert.equal(resolveSerialDevice(device, [other, { ...device, vendorId: "1A86", path: "/dev/ttyACM1" }], "linux"), "/dev/ttyACM1");
  assert.equal(resolveSerialDevice(device, [{ ...device, path: "/dev/ttyUSB8" }, other], "linux"), "/dev/ttyUSB8");
  assert.equal(resolveSerialDevice(device, [{ ...device, path: "/dev/serial/by-id/usb-NIIMBOT_B1_SERIAL-if00" }], "linux"), "/dev/serial/by-id/usb-NIIMBOT_B1_SERIAL-if00");
  assert.equal(resolveSerialDevice(device, [{ ...device, path: "/dev/tty.usbmodem123" }, { ...device, path: "/dev/cu.usbmodem123" }], "darwin"), "/dev/cu.usbmodem123");
  assert.equal(resolveSerialDevice({ ...device, interface: "01" }, [{ ...device, interface: "00", path: "/dev/ttyACM0" }, { ...device, interface: "01", path: "/dev/ttyACM1" }], "linux"), "/dev/ttyACM1");
  assert.deepEqual(validSerialDeviceSelector({ ...device, vendorId: "0X001A", productId: "b" }), { ...device, vendorId: "001a", productId: "000b" });
});

void test("selection fails closed for missing, duplicated or unsafe serial evidence", () => {
  const port = { ...device, path: "/dev/ttyACM0" };
  for (const ports of [[], [{ ...port, serialNumber: "b1-exactserial" }], [{ ...port, vendorId: "0001" }], [{ ...port, productId: "0001" }]]) {
    assert.throws(() => resolveSerialDevice(device, ports, "linux"), category("device_missing"));
  }
  for (const path of ["/tmp/printer", "/dev/null", "/dev/ttyACM", "/dev/ttyACM0/../null", "/dev/serial/by-id/../other", "/dev/serial/by-id/", "/dev/serial/by-id/x\0", "/dev/serial/by-id/x/y", "/dev/cu.usbmodem1"]) {
    assert.throws(() => resolveSerialDevice(device, [{ ...port, path }], "linux"), category("device_missing"));
  }
  for (const path of ["/dev/tty.usbmodem1", "/tmp/cu.usb", "/dev/cu.usb/../../null", "/dev/cu.", "/dev/cu.usb\n"]) {
    assert.throws(() => resolveSerialDevice(device, [{ ...port, path }], "darwin"), category("device_missing"));
  }
  for (const ports of [[port, { ...port, path: "/dev/ttyACM1" }], [port, port], [port, { ...port, path: "/dev/serial/by-id/usb-alias" }], [{ ...port, serialNumber: undefined, pnpId: "usb-B1-ExactSerial" }]]) {
    assert.throws(() => resolveSerialDevice(device, ports, "linux"), category("device_ambiguous"));
  }
  assert.throws(() => resolveSerialDevice({ ...device, interface: "01" }, [port], "linux"), category("device_missing"));
  assert.throws(() => resolveSerialDevice(device, [port], "win32"), category("invalid_config"));
  assert.throws(() => resolveSerialDevice(device, [port, { ...port, serialNumber: "OTHER" }], "linux"), category("device_ambiguous"));
  assert.throws(() => resolveSerialDevice({ ...device, serialNumber: "" }, [port], "linux"), category("invalid_config"));
});

void test("discovery lists metadata without opening serial ports, guessing serials or loading BLE", async (t) => {
  const require = createRequire(import.meta.url);
  const dependencyRequire = createRequire(require.resolve("@mmote/niimbluelib"));
  const { SerialPort } = dependencyRequire("serialport");
  t.mock.method(SerialPort.prototype, "open", () => { throw new Error("Discovery must never open a port"); });
  const path = process.platform === "darwin" ? "/dev/cu.usbmodem1" : "/dev/ttyACM0";
  const ports = [{ ...device, path, pnpId: "usb-B1-ExactSerial-if00", locationId: "20", interface: "00", manufacturer: "NIIMBOT" }, { path, pnpId: "usb-NOT-A-SERIAL" }];
  const list = t.mock.method(SerialPort, "list", async () => ports);
  assert.deepEqual(await listSerialDevices(), [{ ...device, path, pnpId: "usb-B1-ExactSerial-if00", locationId: "20", interface: "00" }, { path, pnpId: "usb-NOT-A-SERIAL" }]);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(Object.keys(require.cache).some(path => /(?:node_ble_impl|bluetooth-hci-socket|@stoprocent)/.test(path)), false);
  list.mock.mockImplementation(async () => { throw new Error("OS inventory failure"); });
  await assert.rejects(listSerialDevices(), category("device_missing"));
});

const payload = {
  purpose: "initial", text: { name: "Ana", affiliation: "WTS" },
  profile: { config: { printerRef: "printer-a", density: 5, feed: { mode: "gap" } } },
  rendererVersion: "renderer-v1", fontVersion: "font-v1", pngBase64: "iVBORw0KGgoAAAANSUhEUg==",
};
const nativePath = (suffix) => process.platform === "darwin" ? `/dev/cu.usbmodem${suffix}` : `/dev/ttyACM${suffix}`;

void test("printer readiness, preparation and physical send each freshly resolve the enrolled identity", async () => {
  const { NiimbotSerialPrinter } = await import("../.output/checkin-runtime/runtime/checkin/printer.js");
  let ports = [{ ...device, path: nativePath(0) }];
  const calls = [];
  let enumerations = 0;
  const selection = { ...device };
  const printer = new NiimbotSerialPrinter("printer-a", {
    device: selection, printerSerial: "PROTOCOL-A", listPorts: async () => { enumerations++; return ports; },
    driver: { print: async (request) => { calls.push(request); } },
  });
  // Enrollment must be a snapshot, not a mutable reference from the config caller.
  selection.serialNumber = "OTHER";
  await printer.checkReady();
  assert.equal(enumerations, 1);
  assert.equal(calls.length, 0);
  await printer.prepare("attempt-a", payload);
  assert.equal(enumerations, 2);
  assert.equal(calls.length, 0);
  ports = [{ ...device, serialNumber: "OTHER", path: nativePath(0) }, { ...device, path: nativePath(7) }];
  await printer.print("attempt-a", payload);
  assert.equal(enumerations, 3);
  assert.deepEqual(calls, [{ address: nativePath(7), model: "B1", density: 5, labelType: 1, printDirection: "top", pngBase64: payload.pngBase64, debug: false, expectedSerial: "PROTOCOL-A" }]);
  const require = createRequire(import.meta.url);
  assert.equal(Object.keys(require.cache).some(path => /(?:node_ble_impl|bluetooth-hci-socket|@stoprocent)/.test(path)), false);
});

void test("unplugged, replaced and duplicate printers block an already prepared print without fallback", async () => {
  const { NiimbotSerialPrinter } = await import("../.output/checkin-runtime/runtime/checkin/printer.js");
  const port = { ...device, path: nativePath(0) };
  let ports = [port];
  const calls = [];
  const printer = new NiimbotSerialPrinter("printer-a", { device, printerSerial: "PROTOCOL-A", listPorts: async () => ports, driver: { print: async (request) => { calls.push(request); } } });
  for (const [inventory, failure] of [[[], "device_missing"], [[{ ...port, serialNumber: "OTHER" }], "device_missing"], [[port, { ...port, path: nativePath(1) }], "device_ambiguous"]]) {
    ports = [port];
    await printer.prepare("attempt-a", payload);
    ports = inventory;
    await assert.rejects(printer.checkReady(), category(failure));
    await assert.rejects(printer.print("attempt-a", payload), category(failure));
    await assert.rejects(printer.prepare("attempt-b", payload), category(failure));
  }
  assert.equal(calls.length, 0);
  // Fresh explicit calls can recover after a replug; the adapter never retries a failed send.
  ports = [{ ...port, path: nativePath(9) }];
  await printer.print("attempt-c", payload);
  assert.equal(calls[0].address, nativePath(9));
});

void test("legacy by-id addressing stays supported but bare paths, path traversal and mixed selectors are invalid", async () => {
  const { NiimbotSerialPrinter } = await import("../.output/checkin-runtime/runtime/checkin/printer.js");
  const calls = [];
  const address = "/dev/serial/by-id/usb-NIIMBOT_B1_test-if00";
  const printer = new NiimbotSerialPrinter("printer-a", { address, listPorts: async () => { throw new Error("Legacy configuration does not enumerate"); }, driver: { print: async (request) => { calls.push(request); } } });
  await printer.checkReady();
  await printer.prepare("attempt-a", payload);
  await printer.print("attempt-a", payload);
  assert.equal(calls[0].address, address);
  for (const options of [{}, { address: "/dev/ttyACM0" }, { address: "/dev/cu.usbmodem1" }, { address: "/tmp/printer" }, { address: "/dev/serial/by-id/../null" }, { address: "/dev/serial/by-id/name/other" }, { address, device }]) {
    assert.throws(() => new NiimbotSerialPrinter("printer-a", options), category("invalid_config"));
  }
});

void test("simulated readiness has no synthetic output side effects", async () => {
  const { SimulatedNiimbotPrinter } = await import("../.output/checkin-runtime/runtime/checkin/printer.js");
  const printer = new SimulatedNiimbotPrinter("printer-a");
  await printer.checkReady();
  assert.deepEqual(printer.printed, []);
});

void test("printer keeps profile fences and never retries a driver failure", async () => {
  const { NiimbotSerialPrinter } = await import("../.output/checkin-runtime/runtime/checkin/printer.js");
  let sends = 0;
  const failure = new Error("simulated uncertain output");
  const printer = new NiimbotSerialPrinter("printer-a", { device, printerSerial: "PROTOCOL-A", listPorts: async () => [{ ...device, path: nativePath(0) }], driver: { print: async () => { sends++; throw failure; } } });
  await printer.prepare("attempt-a", payload);
  const wrong = { ...payload, profile: { config: { ...payload.profile.config, printerRef: "printer-b" } } };
  await assert.rejects(printer.print("attempt-a", wrong), category("printer_identity_mismatch"));
  assert.equal(sends, 0);
  await assert.rejects(printer.print("attempt-b", payload), error => error === failure);
  assert.equal(sends, 1);
});
