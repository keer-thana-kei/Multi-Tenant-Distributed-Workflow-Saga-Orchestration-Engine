const { parentPort, workerData } = require('worker_threads')
const vm = require('vm')

const MAX_RESULT_CHARS = 100000
const { code, inputJson, eventJson, timeoutMs } = workerData

try {
    // Empty context. Nothing from the host is passed in, and string code
    // generation (eval / Function) is disabled.
    const context = vm.createContext({}, {
        codeGeneration: { strings: false, wasm: false }
    })

    const script = `(function () {
  var __input = JSON.parse(${JSON.stringify(inputJson)});
  var __event = JSON.parse(${JSON.stringify(eventJson)});
  var __r = (function (input, event) {
"use strict";
${code}
  })(__input, __event);
  return __r === undefined ? "null" : JSON.stringify(__r);
})()`

    const out = vm.runInContext(script, context, { timeout: timeoutMs })

    if (typeof out !== 'string') {
        parentPort.postMessage({ ok: false, error: 'Script returned an invalid result' })
    } else if (out.length > MAX_RESULT_CHARS) {
        parentPort.postMessage({ ok: false, error: 'Script result is too large' })
    } else {
        parentPort.postMessage({ ok: true, output: JSON.parse(out) })
    }
} catch (err) {
    const message = (err && err.message) ? String(err.message) : String(err)
    parentPort.postMessage({ ok: false, error: message.slice(0, 500) })
}