import { getDoc, getUserId } from "../firestore/dbFetch.js";
import {
  addBuyCoins,
  bet,
  clearBet,
  confirmBet,
  exitRoom,
  checkRoom,
  InvitePlayers,
  // joinAsPlayer,
  // joinAsWatcher,
  joinGame,
  rejoinGame,
  startPreGameTimer,
  makeSliderBet,
  updateChat,
  updateSeenBy,
  typingonChat,
} from "../Functions/game.js";
import {
  doubleAction,
  hitAction,
  splitAction,
  standAction,
  surrender,
  insuranceTaken,
  denyInsurance,
  doInsurance,
} from "../Functions/gameLogic.js";
import roomModel from "../modals/roomModal.js";
import { guid } from "./utils.js";

const socketConnection = (io) => {
  io.users = [];
  io.room = [];
  io.typingPlayers = {};
  const rooms = [];
  io.on("connection", (socket) => {

    console.log("socket.user ==>", socket.user);

    socket.on("checkTable", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await checkRoom(data, socket, io);
    });

    // user bet
    socket.on("bet", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await bet(io, socket, data);
    });

    // user bet with slider
    socket.on("makeSliderBet", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await makeSliderBet(io, socket, data);
    });

    // clear user bet
    socket.on("clearbet", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await clearBet(io, socket, data);
    });

    // reconnect to server
    socket.on("join", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await rejoinGame(io, socket, data);
    });

    socket.on("confirmBet", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await confirmBet(io, socket, data);
    });

    // player action socket
    socket.on("hit", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      process.nextTick(async () => {
        const p = await hitAction(io, socket, data);
        io.in(data.tableId).emit("action", {
          type: "hit",
        });
        if (p?.isBusted) {
          setTimeout(() => {
            io.in(data.tableId).emit("action", {
              type: "burst",
            });
          }, 500);
        }
      });
    });

    socket.on("stand", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await standAction(io, socket, data);
      io.in(data.tableId).emit("action", {
        type: "stand",
      });
    });

    socket.on("double", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      const p = await doubleAction(io, socket, data);
      io.in(data.tableId).emit("action", {
        type: "doubleDown",
      });
      if (p?.isBusted) {
        setTimeout(() => {
          io.in(data.tableId).emit("action", {
            type: "burst",
          });
        }, 500);
      }
    });

    socket.on("split", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await splitAction(io, socket, data);
      io.in(data.tableId).emit("action", {
        type: "split",
      });
    });

    socket.on("surrender", async (data) => {
      console.log("surrender executed", data);
      data = {
        ...data,
        userId: socket.user.userId
      }
      await surrender(io, socket, data);
      io.in(data.tableId).emit("action", {
        type: "surrender",
      });
    });

    socket.on("invPlayers", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await InvitePlayers(io, socket, data);
    });

    // exit room
    socket.on("exitRoom", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await exitRoom(io, socket, data);
    });

    // add more coins
    socket.on("addCoins", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await addBuyCoins(io, socket, data);
    });

    // chat in game
    socket.on("chatMessage", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      io.in(data.tableId.toString()).emit("newMessage", data);
      await updateChat(io, socket, data);
    });

    socket.on("updateChatIsRead", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await updateSeenBy(io, socket, data);
    });

    socket.on("typingOnChat", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await typingonChat(io, socket, data);
    });

    socket.on("insurance", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      console.log("insurance socket emitted");
      await insuranceTaken(io, socket, data);
      io.in(data.tableId).emit("action", {
        type: "insurance",
      });
    });

    socket.on("doInsure", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await doInsurance(io, socket, data);
    });

    socket.on("denyInsurance", async (data) => {
      data = {
        ...data,
        userId: socket.user.userId
      }
      await denyInsurance(io, socket, data);
    });

    // disconnect from server
    socket.on("disconnect", () => {
      try {
        // console.log(
        //   "disconnected",
        //   socket.id,
        //   socket.customId,
        //   socket.customRoom
        // );

        if (!socket.customId || !socket.customRoom) {
          return;
        }

        const lastSockets = io.users;
        console.log({ lastSockets });
        let filteredSockets = lastSockets.filter(
          (el) => el.toString() === socket.customId.toString()
        );
        console.log({ filteredSockets });
        const roomid = io.room;
        console.log({ roomid });
        let filteredRoom = roomid.filter(
          (el) => el.room.toString() === socket.customRoom.toString()
        );
        console.log({ filteredRoom });
        if (filteredSockets.length > 0 && filteredRoom.length > 0) {
          let indexUser = lastSockets.indexOf(socket.customId.toString());
          console.log({ indexUser });
          if (indexUser !== -1) lastSockets.splice(indexUser, 1);

          io.users = lastSockets;

          let data = {
            roomid: socket.customRoom,
            userId: socket.customId,
            tableId: socket.customRoom,
          };

          setTimeout(async () => {
            let dd = { ...data };
            console.log("---- INSIDE SOCKET ----");
            // console.log("IO USERS => ", JSON.stringify(io.users));
            console.log("USERSID => ", JSON.stringify(data));

            if (
              io.users.find((ele) => ele.toString() === dd?.userId?.toString())
            ) {
              console.log("reconnected =>", dd);
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
              console.log("exit room called after 300000 milli sec");
              await exitRoom(io, socket, dd);
            }
          }, 120000);
        } else {
          console.log("FAILED TO COMPLETE DISCONNECT PART");
        }
      } catch (e) {
        console.log("error in disconnect block", e);
      }
    });
  });
};

export default socketConnection;
