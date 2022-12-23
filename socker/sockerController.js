const { SyncScore } = require('../models/sync-scores');

const {
  addUser, getUsers, joinUser,
  getUser,
  removeUser,
  getUsersInRoom,
  pushMediaPipe,
  closeRoom,
  getUserBySocketId,
} = require('./users');

const { syncSimilarity } = require('../syncAlgorithm');

const socker = (server) => {
  const io = require("socket.io")(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE"]
    },
    upgradeTimeout: 30000 // default value is 10000ms, changing it to 20k or more
  });

  io.on('connection', (socket) => {
    console.log(`user conectted! socket= ${socket.id}`.green.bold);
    const socketId = socket.id;
    const users = getUsers();
    io.to(socketId).emit("connected", socketId, users);

    //when im enttering the system i have diffrent socket id 
    socket.on('addUser', (user_id, room_id) => {
      addUser(user_id, socket.id, room_id); //Resets the new socket associated with the user
      let user = getUser(user_id);
      io.emit("getNewUserAddToApp", user);
    });

    socket.on('me', (user_id) => {
      let user = getUser(user_id);
      io.emit("mySocketId", user);
    });

    socket.on('getSocketId', (user_id, callback) => {
      let user = getUser(user_id);
      callback(user)
    });

    socket.on('joinUser', (from, to, roomId, callback) => {
      socket.join(roomId);
      joinUser(from, roomId);
      let users = getUsersInRoom(roomId);
      let res = users;
      io.to(roomId).emit("responsRoomId", res);
    });

    socket.on("callUser", ({ userToCall, signalData, from, name }) => {
      io.to(userToCall).emit("callUser", { signal: signalData, from, name });
    });

    socket.on("calltoTrainee", yourSocketId => {
      let data = true;
      io.to(yourSocketId).emit("calltoTrainee", data);
    });

    socket.on("calltoTraineeQuickMeeting", data => {
      console.log('calltoTraineeQuickMeeting', data);
      let quickMeeting = data.quickMeeting
      io.to(data.yourSocketId).emit("calltoTraineeQuickMeeting", quickMeeting);
    });

    socket.on("answerCall", (data) => {
      io.to(data.to).emit("callAccepted", data.signal, data.start_delay)
    });

    socket.on("sendPoses", (data) => {
      io.to(data.to).emit("resivingPoses", data)
    })


    ///Passing data per frames
    //Each user sends to the server his information. The server maintains a list of points 
    //and forwards a synchronization calculation based on recent times received from both users
    socket.on("sendPosesByPeers", async (data, mySocketId, yourSocketId, trainer, activity, roomId, frameNum) => {
      console.log("sendPosesByPeers", new Date(), mySocketId, yourSocketId, trainer, activity, roomId, frameNum);
      let dataToSync = pushMediaPipe(data, mySocketId, yourSocketId, trainer, activity, roomId);

      console.log('mySocketId', mySocketId, 'dataToSync', dataToSync);
      if (dataToSync) {
        //sync alg
        console.log(" before sendPosesByPeers", new Date());
        let sync_score = syncSimilarity(dataToSync);
        console.log("after sendPosesByPeers", new Date(), 'sync_score send : ', sync_score);
        io.to(roomId).emit("resivingSyncScoure", sync_score);

        //save in db of both usesr
        if (sync_score === undefined || sync_score == null) return;
        let dataToDB = { meeting_id: roomId, result: sync_score, time: data.time, activity: activity }
        const syncscore = await SyncScore.create(dataToDB);
      }
    })


    //when peer2 gets the massage he does a messag him self and retuen the respons to all in the room
    socket.on('sendOurPoses', async (data) => {
      // sync_score = number between 0-1
      let sync_score = syncSimilarity(data);

      let d = {
        me: { poses: [{ x: 2, y: 1.5 }, { x: 4, y: 3 }] },
        you: { poses: [{ x: -2, y: -1.5 }, { x: -4, y: -3 }] }
      }
      //console.log(" before sendPosesByPeers", new Date());
      //console.log('sync_angals', sync_score);
      //console.log("after sendPosesByPeers", new Date(), 'sync_score send : ', sync_score);
      //send back to bouth in room
      io.to(data.roomId).emit("syncScore", sync_score);

      //save in db of both usesr
      if (sync_score === undefined || sync_score == null) return;
      let dataToDB = { meeting_id: data.roomId, result: sync_score, time: data.time, activity: data.activity }
      const syncscore = await SyncScore.create(dataToDB);
    });

    socket.on("sendNotification", (data) => {
      let notification = data.notification;
      io.to(data.roomId).emit("notification", notification);
    });

    socket.on("statePeer", (data) => {
      let state = data.state;
      io.to(data.yourSocketId).emit("statePeer", state);
    });

    socket.on("peer1inFrame", (yourSocketId) => {
      io.to(yourSocketId).emit("peer1inFrame", yourSocketId);
    });

    socket.on("accseptScheduleMeetingCall", (yourSocketId) => {
      let id = true
      io.to(yourSocketId).emit("accseptScheduleMeetingCall", id);
    });

    socket.on("t", (data) => {
      let id = true
      const users = getUsersInRoom(data.roomId);
      users.map(user => {
        if (user.socketId !== socket.id) {
          io.to(user.socketId).emit("t", id);
          return;
        }
      })
      io.to(data.yourSocketId).emit("t", id);
    });

    socket.on("t-trainer", (data) => {
      let id = true
      const users = getUsersInRoom(data.roomId);
      users.map(user => {
        if (user.socketId !== socket.id) {
          io.to(user.socketId).emit("t", id);
          return;
        }
      })
      io.to(data.yourSocketId).emit("t-trainer", id);
    });

    socket.on("meetingComplited", (data) => {
      io.to(data.to).emit("meetingComplited", data);
    });

    socket.on("updateUpcomingMeeting", (data) => {
      io.to(data.to).emit("updateUpcomingMeeting", data);
    });

    socket.on("error", (err) => {
      //console.log(`Error socket server: ${err}`);
    });

    socket.on("closeRoom", (meetingId) => {
      console.log('closeRoom', meetingId);
      //notify to the room about this action...
      //case user close the room and another is in the room waiting for his to reconect
      closeRoom(meetingId._id);
      io.to(meetingId._id).emit("closeRoom", meetingId);
    });

    socket.on("closeRoomByDeclining", (data) => {
      console.log('closeRoomByDeclining', data);
      //notify to the room about this action...
      //case user close the room and another is in the room waiting for his to reconect
      closeRoom(data.roomId);
      io.to(data.yourSocketId).emit("closeRoomByDeclining", data);
    });

    // socket.on("dataToReconect", data => {
    // //console.log('reconect userId', data);
    //   io.to(data.yourSocketId).emit("dataToReconect", data);
    // });

    // socket.on("traineeReconect", trainee => {
    // //console.log('reconect userId', trainee);
    //   io.to(trainee).emit("traineeReconect", trainee);
    // });

    socket.on("reconect", (userId, roomId) => {
      addUser(userId, socket.id, roomId); //Resets the new socket associated with the user
      roomId && socket.join(roomId);
      let user = getUser(userId);
      let users = getUsersInRoom(roomId);
      //notify to the room about this action...
      //case user close the room and another is in the room waiting for his to reconect
      io.to(roomId).emit("reconect", users);
    });

    socket.on("disconnectLogout", (userId) => {
      //handele when clicked on logout
      let user_disconrct = null
      if (userId) user_disconrct = getUser(userId);
      if (user_disconrct) {
        let user_in_seeion = removeUser(user_disconrct.socketId);
        if (user_in_seeion) { //notiffy the roomId
          let userId = user_in_seeion.userId;
          io.to(user_in_seeion.roomId).emit("userLeft", userId);
        }
        else   //else this user has roomId=undifind (retuend null) so no need to notify to anyone he left 
          console.log('No notify sended - user left and clear out from users lists');
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`a user disconnected! socket= ${socket.id}`.red.underline.bold);
      console.log(`reason ====> ${reason}`.yellow.bold);

      let user = getUserBySocketId(socket.id);
      if (user === null) return;
      if (reason) { /*client chacks for reason === "ping timeout" for handeling socket disconect errors*/
        io.to(user.roomId).emit("disconnected", reason);
      }
      console.log(`removeSocket ${socket.id}`.red.bold);
      let user_in_seeion = removeUser(socket.id);
      console.log(`after removeSocket ${socket.id}`.red.bold);
      if (user_in_seeion) { //notiffy the roomId
        let userId = user_in_seeion.userId;
        console.log(`call to client`.red.bold);
        io.to(user_in_seeion.roomId).emit("userLeft", userId, reason);
      }
      else   //else this user has roomId=undifind (retuend null) so no need to notify to anyone he left 
        console.log('No notify sended - user left and clear out from users lists');
    });
  });

  return io;
};

module.exports = socker;