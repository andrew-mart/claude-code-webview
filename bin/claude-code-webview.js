#!/usr/bin/env node
// @ts-check
// claude-code-webview — Claude Code sessions in the browser. Run with --help for options.
import { main } from '../cli/main.js';

process.exitCode = await main(process.argv.slice(2));
