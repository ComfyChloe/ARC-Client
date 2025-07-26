const fs = require('fs');
const WebSocket = require('ws');
const readline = require('readline');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const wsUrl = config.websocketUrl;
const ws = new WebSocket(wsUrl);
ws.on('open', () => {
    console.log(`Connected to ${wsUrl}`);
    rl.prompt();
});
ws.on('message', (data) => {
    console.log(`\n[Server]: ${data}`);
    rl.prompt();
});
ws.on('close', () => {
    console.log('Connection closed.');
    process.exit(0);
});
ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    process.exit(1);
});
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});
rl.on('line', (line) => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(line.trim());
    } else {
        console.log('WebSocket not connected.');
    }
    rl.prompt();
});
rl.on('SIGINT', () => {
    ws.close();
    rl.close();
});