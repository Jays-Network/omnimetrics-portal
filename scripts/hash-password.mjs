#!/usr/bin/env node
// Prints a bcrypt hash (cost 12) for a password.
//
// The password is read from a hidden interactive prompt, or from stdin when
// piped. It is NEVER accepted as a command-line argument (argv is visible in
// `ps` and shell history).
//
//   node scripts/hash-password.mjs                 # hidden prompt (asks twice)
//   printf '%s' "$PW" | node scripts/hash-password.mjs   # from stdin
//
// Prompts go to stderr; only the hash goes to stdout.

import bcrypt from 'bcryptjs'

const COST = 12
const MIN_LENGTH = 12
const MAX_BYTES = 72 // bcrypt ignores everything past 72 bytes

if (process.argv.length > 2) {
  console.error('Refusing to take a password as an argument. Run with no arguments; the password is read from a prompt or stdin.')
  process.exit(1)
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    let value = ''
    process.stderr.write(label)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const finish = (fn, arg) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stderr.write('\n')
      fn(arg)
    }

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(resolve, value)
        if (ch === '\u0003') return finish(reject, new Error('Cancelled')) // Ctrl-C
        if (ch === '\u0004') return finish(resolve, value) // Ctrl-D
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function getPassword() {
  if (!process.stdin.isTTY) {
    return (await readAllStdin()).replace(/\r?\n$/, '')
  }
  const first = await promptHidden('Password: ')
  const second = await promptHidden('Confirm password: ')
  if (first !== second) {
    throw new Error('Passwords do not match')
  }
  return first
}

try {
  const password = await getPassword()
  if (password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters`)
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) {
    throw new Error(`Password must be at most ${MAX_BYTES} bytes (bcrypt limit)`)
  }
  process.stdout.write(`${await bcrypt.hash(password, COST)}\n`)
} catch (error) {
  console.error(`Error: ${error.message}`)
  process.exit(1)
}
