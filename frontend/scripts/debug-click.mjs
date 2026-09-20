import fs from 'node:fs';
import { spawn } from 'node:child_process';

async function main() {
  const wsUrl = fs.readFileSync('C:\\Users\\DELL\\.gemini\\antigravity-ide\\brain\\e39bbe94-1bd5-4bd2-81c3-7de1e5e586fc\\.system_generated\\tasks\\task-681.log', 'utf8')
    .match(/DevTools listening on (ws:\/\/.+)/)?.[1];
  if (!wsUrl) {
    console.error("No WS URL found");
    return;
  }
  
  const ws = new globalThis.WebSocket(wsUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  let msgId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      if (data.error) pending.get(data.id).reject(new Error(data.error.message));
      else pending.get(data.id).resolve(data.result);
      pending.delete(data.id);
    }
  });

  const send = (method, params) => {
    const id = msgId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const { targetInfos } = await send('Target.getTargets', {});
  const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('localhost'));
  if (!page) {
    console.error("No page found");
    ws.close();
    return;
  }

  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  
  const sendToSession = (method, params) => {
    const id = msgId++;
    ws.send(JSON.stringify({ sessionId, id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const evalResult = await sendToSession('Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector('[data-testid=map-card] path.leaflet-interactive');
        if (!el) return 'No leaflet marker found';
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const topEl = document.elementFromPoint(x, y);
        if (!topEl) return 'Nothing at ' + x + ',' + y;
        return topEl.tagName + '.' + topEl.className;
      })()
    `,
    returnByValue: true
  });

  console.log('Element under marker:', evalResult.result.value);
  ws.close();
}

main().catch(console.error);
