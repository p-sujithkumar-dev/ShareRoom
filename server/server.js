
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const { Server } = require("socket.io");

const connectDB = require("./config/db");

const Room = require("./models/Room");
const File = require("./models/File");

const roomRoutes = require("./routes/roomRoutes");
const fileRoutes = require("./routes/fileRoutes");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        methods: ["GET", "POST"]
    }
});

app.set("io", io);

app.use(cors({ origin: true }));
app.use(express.json());

connectDB();

app.get("/", (req, res) => {
    res.json({
        message: "ShareRoom API Running Successfully"
    });
});

app.use("/api/rooms", roomRoutes);
app.use("/api/files", fileRoutes);

// =====================================
// ROOM DEVICE MANAGEMENT
// =====================================

const roomStates = new Map();

const getRoomState = (roomId) => {
    if (!roomStates.has(roomId)) {
        roomStates.set(roomId, {
            devices: new Map(),
            hostDeviceId: null,

            // Devices removed by host
            removedDevices: new Set(),

            // Pending approval requests
            requests: new Map(),

            closing: false
        });
    }

    return roomStates.get(roomId);
};

// =====================================
// ONLINE DEVICES
// =====================================

const getOnlineDevices = (state) => {
    return Array.from(state.devices.values())
        .filter(device => device.sockets.size > 0);
};

// =====================================
// TRANSFER HOST
// =====================================

const transferHost = (roomId, state) => {

    if (state.hostDeviceId) {
        const currentHost = state.devices.get(
            state.hostDeviceId
        );

        if (currentHost && currentHost.sockets.size > 0) {
            return;
        }
    }

    const nextDevice = getOnlineDevices(state)[0];

    state.hostDeviceId = nextDevice
        ? nextDevice.deviceId
        : null;

    if (nextDevice) {
        io.to(roomId).emit("host-changed", {
            hostDeviceId: nextDevice.deviceId,
            hostDeviceName: nextDevice.deviceName
        });
    }
};

// =====================================
// BROADCAST DEVICE LIST
// =====================================

const broadcastDevices = (roomId) => {

    const state = roomStates.get(roomId);

    if (!state) return;

    const devices = Array.from(state.devices.values()).map(
        device => ({
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            online: device.sockets.size > 0,
            isHost: device.deviceId === state.hostDeviceId,
            lastSeen: device.lastSeen
        })
    );

    const onlineCount = devices.filter(
        device => device.online
    ).length;

    io.to(roomId).emit("device-list", devices);

    io.to(roomId).emit("device-count", {
        count: onlineCount
    });
};

// =====================================
// SEND APPROVAL REQUEST TO HOST
// =====================================

const notifyHost = (roomId, state, request) => {

    if (!state.hostDeviceId) return;

    const host = state.devices.get(
        state.hostDeviceId
    );

    if (!host) return;

    for (const socketId of host.sockets) {

        const hostSocket = io.sockets.sockets.get(socketId);

        if (hostSocket) {
            hostSocket.emit("device-approval-request", {
                deviceId: request.deviceId,
                deviceName: request.deviceName,
                roomId,
                requestedAt: request.requestedAt
            });
        }
    }
};

// =====================================
// ROOM CLEANUP
// =====================================

const deleteRoomCompletely = async (roomId) => {

    const state = roomStates.get(roomId);

    if (!state || state.closing) return;

    // Do not delete while a device is connected
    if (getOnlineDevices(state).length > 0) return;

    state.closing = true;

    try {

        // Get all files belonging to this room
        const roomFiles = await File.find({ roomId });

        // Delete physical files from uploads folder
        const uploadsPath = path.join(
            __dirname,
            "uploads"
        );

        await Promise.allSettled(
            roomFiles.map(file => {
                const filePath = path.join(
                    uploadsPath,
                    file.storedName
                );

                return fs.promises.unlink(filePath);
            })
        );

        // Delete file metadata
        await File.deleteMany({ roomId });

        // Delete room from MongoDB
        await Room.deleteOne({ roomId });

        // Remove room state from memory
        roomStates.delete(roomId);

        console.log(
            `Room ${roomId} completely deleted`
        );

    } catch (error) {

        state.closing = false;

        console.error(
            "Room Cleanup Error:",
            error
        );

    }
};

// =====================================
// REMOVE SOCKET FROM ROOM
// =====================================

const removeSocketFromRoom = async (
    socket,
    intentionalLeave = false
) => {

    const roomId = socket.data.roomId;
    const deviceId = socket.data.deviceId;

    if (!roomId || !deviceId) return;

    const state = roomStates.get(roomId);

    if (!state) return;

    const device = state.devices.get(deviceId);

    if (device) {

        device.sockets.delete(socket.id);

        if (device.sockets.size === 0) {

            device.lastSeen = new Date();

            // Explicit Leave removes device entry
            if (intentionalLeave) {
                state.devices.delete(deviceId);
            }

        }

    }

    socket.leave(roomId);

    socket.data.roomId = null;
    socket.data.deviceId = null;

    // Transfer host if necessary
    if (state.hostDeviceId === deviceId) {
        transferHost(roomId, state);
    }

    broadcastDevices(roomId);

    // Delete room only after intentional leave
    // and when nobody is online.
    if (
        intentionalLeave &&
        getOnlineDevices(state).length === 0
    ) {

        await deleteRoomCompletely(roomId);

    }

};

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

    console.log("Device Connected:", socket.id);

    // =================================
    // JOIN ROOM
    // =================================

    socket.on("join-room", async (data) => {

        try {

            const roomId = typeof data === "string"
                ? data
                : data?.roomId;

            const deviceId = typeof data === "object"
                ? data.deviceId
                : socket.id;

            const deviceName = typeof data === "object"
                ? data.deviceName
                : "Unknown Device";

            if (!roomId || !deviceId) {

                socket.emit(
                    "room-error",
                    "Invalid room details"
                );

                return;
            }

            const cleanRoomId = String(roomId)
                .trim()
                .toUpperCase();

            const cleanDeviceId = String(deviceId)
                .trim()
                .slice(0, 100);

            const cleanDeviceName = String(
                deviceName || "Unknown Device"
            )
                .trim()
                .slice(0, 40);

            const room = await Room.findOne({
                roomId: cleanRoomId,
                active: true
            });

            if (!room) {

                socket.emit(
                    "room-error",
                    "Invalid Room ID"
                );

                return;
            }

            const state = getRoomState(cleanRoomId);

            if (state.closing) {
                socket.emit(
                    "room-error",
                    "Room is being deleted. Create a new room."
                );

                return;
            }

            // Remove previous room connection
            if (socket.data.roomId) {
                await removeSocketFromRoom(socket);
            }

            // =================================
            // CHECK REMOVED DEVICE
            // =================================

            if (state.removedDevices.has(cleanDeviceId)) {

                let request = state.requests.get(
                    cleanDeviceId
                );

                if (!request) {

                    request = {
                        deviceId: cleanDeviceId,
                        deviceName: cleanDeviceName,
                        sockets: new Set(),
                        requestedAt: new Date()
                    };

                    state.requests.set(
                        cleanDeviceId,
                        request
                    );

                }

                request.deviceName = cleanDeviceName;
                request.sockets.add(socket.id);

                socket.data.pendingRoomId = cleanRoomId;
                socket.data.pendingDeviceId = cleanDeviceId;

                socket.emit("approval-pending", {
                    message: "Permission required. Waiting for host approval.",
                    roomId: cleanRoomId
                });

                notifyHost(
                    cleanRoomId,
                    state,
                    request
                );

                return;
            }

            // =================================
            // NORMAL DEVICE JOIN
            // =================================

            let device = state.devices.get(
                cleanDeviceId
            );

            if (!device) {

                device = {
                    deviceId: cleanDeviceId,
                    deviceName: cleanDeviceName,
                    sockets: new Set(),
                    lastSeen: null
                };

                state.devices.set(
                    cleanDeviceId,
                    device
                );

            }

            device.deviceName = cleanDeviceName;
            device.sockets.add(socket.id);
            device.lastSeen = null;

            socket.join(cleanRoomId);

            socket.data.roomId = cleanRoomId;
            socket.data.deviceId = cleanDeviceId;

            transferHost(cleanRoomId, state);

            socket.emit("room-joined", {
                roomId: cleanRoomId,
                deviceId: cleanDeviceId,
                deviceName: cleanDeviceName
            });

            broadcastDevices(cleanRoomId);

            console.log(
                `${cleanDeviceName} joined ${cleanRoomId}`
            );

        } catch (error) {

            console.error("Join Room Error:", error);

            socket.emit(
                "room-error",
                "Unable to join room"
            );

        }

    });

    // =================================
    // HOST REMOVE DEVICE
    // =================================

    socket.on("host-remove-device", ({ deviceId } = {}) => {

        try {

            const roomId = socket.data.roomId;
            const currentDeviceId = socket.data.deviceId;

            if (!roomId || !currentDeviceId || !deviceId) {
                return;
            }

            const state = roomStates.get(roomId);

            if (!state) return;

            // Only Host can remove
            if (state.hostDeviceId !== currentDeviceId) {

                socket.emit(
                    "host-action-error",
                    "Only the room host can remove devices"
                );

                return;
            }

            if (deviceId === state.hostDeviceId) {

                socket.emit(
                    "host-action-error",
                    "Host cannot remove itself"
                );

                return;
            }

            const target = state.devices.get(deviceId);

            if (!target || target.sockets.size === 0) {

                socket.emit(
                    "host-action-error",
                    "Device is not online"
                );

                return;
            }

            // Mark device as requiring approval
            state.removedDevices.add(deviceId);

            // Disconnect all sockets belonging to device
            for (const socketId of target.sockets) {

                const targetSocket =
                    io.sockets.sockets.get(socketId);

                if (targetSocket) {

                    targetSocket.emit("device-removed", {
                        message: "Host removed you. Permission is required to join again."
                    });

                    targetSocket.leave(roomId);

                    targetSocket.data.roomId = null;
                    targetSocket.data.deviceId = null;

                }

            }

            state.devices.delete(deviceId);

            broadcastDevices(roomId);

            console.log(
                `Host removed ${deviceId} from ${roomId}`
            );

        } catch (error) {

            console.error("Remove Device Error:", error);

            socket.emit(
                "host-action-error",
                "Unable to remove device"
            );

        }

    });

    // =================================
    // HOST APPROVE DEVICE
    // =================================

    socket.on("approve-device", ({ deviceId } = {}) => {

        try {

            const roomId = socket.data.roomId;
            const currentDeviceId = socket.data.deviceId;

            if (!roomId || !deviceId) return;

            const state = roomStates.get(roomId);

            if (!state) return;

            // Verify Host
            if (state.hostDeviceId !== currentDeviceId) {

                socket.emit(
                    "host-action-error",
                    "Only the room host can approve devices"
                );

                return;
            }

            const request = state.requests.get(deviceId);

            if (!request) return;

            // Remove approval restriction
            state.removedDevices.delete(deviceId);
            state.requests.delete(deviceId);

            let device = state.devices.get(deviceId);

            if (!device) {

                device = {
                    deviceId,
                    deviceName: request.deviceName,
                    sockets: new Set(),
                    lastSeen: null
                };

                state.devices.set(deviceId, device);

            }

            device.deviceName = request.deviceName;

            // Connect pending sockets
            for (const socketId of request.sockets) {

                const targetSocket =
                    io.sockets.sockets.get(socketId);

                if (!targetSocket) continue;

                targetSocket.join(roomId);

                targetSocket.data.roomId = roomId;
                targetSocket.data.deviceId = deviceId;
                targetSocket.data.pendingRoomId = null;
                targetSocket.data.pendingDeviceId = null;

                device.sockets.add(socketId);

                targetSocket.emit("room-joined", {
                    roomId,
                    deviceId,
                    deviceName: request.deviceName
                });

                targetSocket.emit("approval-granted", {
                    message: "Host approved your request"
                });

            }

            device.lastSeen = null;

            broadcastDevices(roomId);

            console.log(
                `Host approved ${deviceId} for ${roomId}`
            );

        } catch (error) {

            console.error("Approve Device Error:", error);

            socket.emit(
                "host-action-error",
                "Unable to approve device"
            );

        }

    });

    // =================================
    // HOST REJECT DEVICE
    // =================================

    socket.on("reject-device", ({ deviceId } = {}) => {

        try {

            const roomId = socket.data.roomId;
            const currentDeviceId = socket.data.deviceId;

            if (!roomId || !deviceId) return;

            const state = roomStates.get(roomId);

            if (!state) return;

            // Verify Host
            if (state.hostDeviceId !== currentDeviceId) {

                socket.emit(
                    "host-action-error",
                    "Only the room host can reject devices"
                );

                return;
            }

            const request = state.requests.get(deviceId);

            if (!request) return;

            // Keep device in removedDevices
            state.requests.delete(deviceId);

            for (const socketId of request.sockets) {

                const targetSocket =
                    io.sockets.sockets.get(socketId);

                if (targetSocket) {

                    targetSocket.emit("approval-rejected", {
                        message: "Host rejected your join request"
                    });

                    targetSocket.data.pendingRoomId = null;
                    targetSocket.data.pendingDeviceId = null;

                }

            }

            console.log(
                `Host rejected ${deviceId} for ${roomId}`
            );

        } catch (error) {

            console.error("Reject Device Error:", error);

            socket.emit(
                "host-action-error",
                "Unable to reject device"
            );

        }

    });

    // =================================
    // LEAVE ROOM
    // =================================

    socket.on("leave-room", async () => {

        await removeSocketFromRoom(
            socket,
            true
        );

    });

    // =================================
    // DISCONNECT
    // =================================

    socket.on("disconnect", async () => {

        // Unexpected disconnect does not delete room.
        // This allows browser refresh and reconnection.

        await removeSocketFromRoom(socket, false);

        // Remove pending request socket if disconnected
        const pendingRoomId = socket.data.pendingRoomId;
        const pendingDeviceId = socket.data.pendingDeviceId;

        if (pendingRoomId && pendingDeviceId) {

            const state = roomStates.get(pendingRoomId);

            const request = state?.requests.get(
                pendingDeviceId
            );

            if (request) {

                request.sockets.delete(socket.id);

                if (request.sockets.size === 0) {
                    state.requests.delete(pendingDeviceId);
                }

            }

        }

        console.log(
            "Device Disconnected:",
            socket.id
        );

    });

});

// =====================================
// SERVER START
// =====================================

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        `ShareRoom Server running on port ${PORT}`
    );

});
