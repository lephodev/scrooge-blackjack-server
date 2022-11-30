import { getDoc, getUserId } from '../firestore/dbFetch.js';
import {
  addBuyCoins,
  bet,
  checkForTable,
  clearBet,
  confirmBet,
  createNewGame,
  exitRoom,
  checkRoom,
  InvitePlayers,
  // joinAsPlayer,
  // joinAsWatcher,
  joinGame,
  rejoinGame,
  startPreGameTimer,
} from '../Functions/game.js';
import {
  doubleAction,
  hitAction,
  splitAction,
  standAction,
  surrender,
} from '../Functions/gameLogic.js';
import roomModel from '../modals/roomModal.js';
import { guid } from './utils.js';

const socketConnection = (io) => {
  io.users = [];
  io.room = [];
  io.on('connection', (socket) => {
    socket.on('checkTable', async (data) => {
      await checkRoom(data, socket, io);
    });

    // user bet
    socket.on('bet', async (data) => {
      await bet(io, socket, data);
    });

    // clear user bet
    socket.on('clearbet', async (data) => {
      await clearBet(io, socket, data);
    });

    // reconnect to server
    socket.on('join', async (data) => {
      await rejoinGame(io, socket, data);
    });

    socket.on('confirmBet', async (data) => {
      await confirmBet(io, socket, data);
    });

    // player action socket
    socket.on('hit', async (data) => {
      const p = await hitAction(io, socket, data);
      io.in(data.tableId).emit('action', {
        type: 'hit',
      });
      if (p.isBusted) {
        setTimeout(() => {
          io.in(data.tableId).emit('action', {
            type: 'burst',
          });
        }, 500);
      }
    });

    socket.on('stand', async (data) => {
      await standAction(io, socket, data);
      io.in(data.tableId).emit('action', {
        type: 'stand',
      });
    });

    socket.on('double', async (data) => {
      const p = await doubleAction(io, socket, data);
      io.in(data.tableId).emit('action', {
        type: 'doubleDown',
      });
      if (p.isBusted) {
        setTimeout(() => {
          io.in(data.tableId).emit('action', {
            type: 'burst',
          });
        }, 500);
      }
    });

    socket.on('split', async (data) => {
      await splitAction(io, socket, data);
      io.in(data.tableId).emit('action', {
        type: 'split',
      });
    });

    socket.on('surrender', async (data) => {
      await surrender(io, socket, data);
      io.in(data.tableId).emit('action', {
        type: 'surrender',
      });
    });

    socket.on('invPlayers', async (data) => {
      await InvitePlayers(io, socket, data);
    });

    // exit room
    socket.on('exitRoom', async (data) => {
      await exitRoom(io, socket, data);
    });

    // add more coins
    socket.on('addCoins', async (data) => {
      await addBuyCoins(io, socket, data);
    });

    // chat in game
    socket.on('chatMessage', (data) => {
      io.in(data.tableId.toString()).emit('newMessage', data);
    });

    // disconnect from server
    socket.on('disconnect', () => {
      try {
        console.log(
          'disconnected',
          socket.id,
          socket.customId,
          socket.customRoom
        );

        const lastSockets = io.users;
        let filteredSockets = lastSockets.filter(
          (el) => el === socket.customId
        );
        const roomid = io.room;
        let filteredRoom = roomid.filter((el) => el.room === socket.customRoom);
        if (filteredSockets.length > 0 && filteredRoom.length > 0) {
          let indexUser = lastSockets.indexOf(socket.customId);
          if (indexUser !== -1) lastSockets.splice(indexUser, 1);

          io.users = lastSockets;

          let data = {
            roomid: socket.customRoom,
            userId: socket.customId,
            tableId: socket.customRoom,
          };

          setTimeout(async () => {
            let dd = { ...data };
            if (io.users.find((ele) => ele === dd.userId)) {
              console.log('reconnected =>', dd);
              await roomModel.updateOne(
                {
                  $and: [
                    { tableId: dd.tableId },
                    { leaveReq: { $elemMatch: { id: dd.userId } } },
                  ],
                },
                {
                  $pull: {
                    leaveReq: dd.userId,
                  },
                }
              );
              return;
            } else {
              console.log('exit room called after 300000 milli sec');
              await exitRoom(io, socket, dd);
            }
          }, 120000);
        }
      } catch (e) {
        console.log('error in disconnect block', e);
      }
    });
  });
};

export default socketConnection;
