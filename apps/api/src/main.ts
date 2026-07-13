import { createServer } from 'node:http';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Hello from api' }));
});

server.listen(port, host, () => {
  console.log(`api listening on http://${host}:${port}`);
  console.log('API is running...');
});
