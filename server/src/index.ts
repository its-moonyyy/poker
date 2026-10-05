import { Server } from 'colyseus';
import { createServer } from 'node:http';
import { TableRoom } from './rooms/TableRoom.js';

const port = Number(process.env.COLYSEUS_PORT ?? 2567);
const server = new Server({ server: createServer() });
server.define('poker-table', TableRoom);
void server.listen(port).then(() => console.log(`poker server on :${port}`));
