
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");

const { Server } = require("socket.io");

const connectDB = require("./config/db");

const Room = require("./models/Room");

const roomRoutes = require("./routes/roomRoutes");
const fileRoutes = require("./routes/fileRoutes");

const app = express();
const server = http.createServer(app);

// ===============================
// MIDDLEWARE
// ===============================

const allowedOrigins = (
    process.env.CLIENT_URL || "http://localhost:5173"
)
    .split(",")
    .map((origin) => origin.trim());

app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
    }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// SOCKET.IO
// ===============================

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
    maxHttpBufferSize: 1e8,
});

// ===============================
// ROOM STATES
// ===============================

const roomStates = new Map();

app.set("roomStates", roomStates);

// Room state structure:
//
// {
//   devices: Map(),
//   hostDeviceId: null,
//   removedDevices: Set(),
//   requests: Map(),
//   closing: false
// }

// ===============================
// ROOM HELPERS
// ===============================

const getRoomState = (roomId) => {
    if (!roomStates.has(roomId)) {
        roomStates.set(roomId, {
            devices: new Map(),
            hostDeviceId: null,
            removedDevices: new Set(),
            requests: new Map(),
            closing: false,
        });
    }

    return roomStates.get(roomId);
};

// ===============================
// GET ONLINE DEVICES
// ===============================

const getOnlineDevices = (state) => {
    return Array.from(state.devices.values()).map((device) => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        isHost: device.deviceId === state.hostDeviceId,
        socketCount: device.sockets.size,
    }));
};

// ===============================
// BROADCAST DEVICE DETAILS
// ===============================

const broadcastDevices = (roomId) => {
    const state = roomStates.get(roomId);

    if (!state) return;

    const devices = getOnlineDevices(state);

    io.to(roomId).emit("device-list", devices);

    io.to(roomId).emit("device-count", {
        count: devices.length,
    });
};

// ===============================
// FIND DEVICE BY SOCKET
// ===============================

const getDeviceBySocket = (socket) => {
    const roomId = socket.data.roomId;
    const deviceId = socket.data.deviceId;

    if (!roomId || !deviceId) return null;

    const state = roomStates.get(roomId);

    if (!state) return null;

    const device = state.devices.get(deviceId);

    if (!device || !device.sockets.has(socket.id)) {
        return null;
    }

    return { roomId, state, device };
};

// ===============================
// HOST TRANSFER
// ===============================

const transferHost = (roomId) => {
    const state = roomStates.get(roomId);

    if (!state) return;

    const availableDevices = Array.from(state.devices.values()).filter(
        (device) => device.sockets.size > 0,
    );

    if (availableDevices.length === 0) {
        state.hostDeviceId = null;
        return;
    }

    const newHost = availableDevices[0];

    state.hostDeviceId = newHost.deviceId;

    io.to(roomId).emit("host-changed", {
        hostDeviceName: newHost.deviceName,
        hostDeviceId: newHost.deviceId,
    });

    broadcastDevices(roomId);
};

// ===============================
// NOTIFY HOST
// ===============================

const notifyHost = (roomId, event, data) => {
    const state = roomStates.get(roomId);

    if (!state || !state.hostDeviceId) return;

    const host = state.devices.get(state.hostDeviceId);

    if (!host) return;

    host.sockets.forEach((socketId) => {
        io.to(socketId).emit(event, data);
    });
};

// ===============================
// REMOVE SOCKET FROM ROOM
// ===============================

const removeSocketFromRoom = (socket) => {
    const roomId = socket.data.roomId;
    const deviceId = socket.data.deviceId;

    if (!roomId || !deviceId) return;

    const state = roomStates.get(roomId);

    if (!state) return;

    // Remove pending request if applicable

    const request = state.requests.get(deviceId);

    if (request && request.socketId === socket.id) {
        state.requests.delete(deviceId);
    }

    const device = state.devices.get(deviceId);

    if (!device) {
        socket.leave(roomId);
        socket.data.roomId = null;
        socket.data.deviceId = null;
        return;
    }

    device.sockets.delete(socket.id);

    socket.leave(roomId);

    socket.data.roomId = null;
    socket.data.deviceId = null;

    // Other tabs/devices with the same device ID are still connected

    if (device.sockets.size > 0) {
        broadcastDevices(roomId);
        return;
    }

    state.devices.delete(deviceId);

    // Transfer host if the host disconnected

    if (state.hostDeviceId === deviceId) {
        transferHost(roomId);
    }

    broadcastDevices(roomId);

    // Remove empty room state from memory

    if (state.devices.size === 0 && state.requests.size === 0) {
        roomStates.delete(roomId);
    }
};

// ===============================
// SOCKET CONNECTION
// ===============================

io.on("connection", (socket) => {
    console.log("Socket Connected:", socket.id);

    // =============================
    // JOIN ROOM
    // =============================

    socket.on("join-room", async (data) => {
        try {
            const cleanRoomId = String(data?.roomId || "")
                .trim()
                .toUpperCase();

            const deviceId = String(data?.deviceId || "").trim();

            const deviceName = String(
                data?.deviceName || "Unknown Device",
            ).trim();

            if (!cleanRoomId || !deviceId) {
                socket.emit("room-error", "Invalid Room ID");
                return;
            }

            // Check room in MongoDB

            const room = await Room.findOne({
                roomId: cleanRoomId,
            });

            if (!room || room.active === false) {
                socket.emit("room-error", "Invalid Room ID");
                return;
            }

            const state = getRoomState(cleanRoomId);

            if (state.closing) {
                socket.emit("room-error", "Room is closing");
                return;
            }

            // Previously removed device cannot rejoin

            if (state.removedDevices.has(deviceId)) {
                socket.emit(
                    "room-error",
                    "You have been removed from this room",
                );
                return;
            }

            // Existing approved device reconnecting

            const existingDevice = state.devices.get(deviceId);

            if (existingDevice) {
                existingDevice.sockets.add(socket.id);
                existingDevice.deviceName = deviceName;

                socket.data.roomId = cleanRoomId;
                socket.data.deviceId = deviceId;

                socket.join(cleanRoomId);

                socket.emit("room-joined", {
                    roomId: cleanRoomId,
                    roomName: room.roomName || "My Shared Room",
                    deviceId,
                    deviceName,
                });

                broadcastDevices(cleanRoomId);

                console.log(
                    `${deviceName} reconnected to room ${cleanRoomId}`,
                );

                return;
            }

            // First device becomes host

            if (state.devices.size === 0 && !state.hostDeviceId) {
                state.devices.set(deviceId, {
                    deviceId,
                    deviceName,
                    sockets: new Set([socket.id]),
                });

                state.hostDeviceId = deviceId;

                socket.data.roomId = cleanRoomId;
                socket.data.deviceId = deviceId;

                socket.join(cleanRoomId);

                socket.emit("room-joined", {
                    roomId: cleanRoomId,
                    roomName: room.roomName || "My Shared Room",
                    deviceId,
                    deviceName,
                });

                broadcastDevices(cleanRoomId);

                console.log(
                    `${deviceName} created host connection for ${cleanRoomId}`,
                );

                return;
            }

            // Existing pending request

            const existingRequest = state.requests.get(deviceId);

            if (existingRequest) {
                existingRequest.socketId = socket.id;
                existingRequest.deviceName = deviceName;

                socket.emit("approval-pending", {
                    message: "Waiting for Host Approval",
                });

                notifyHost(cleanRoomId, "device-approval-request", {
                    deviceId,
                    deviceName,
                });

                return;
            }

            // New device requests approval

            state.requests.set(deviceId, {
                deviceId,
                deviceName,
                socketId: socket.id,
            });

            socket.data.roomId = cleanRoomId;
            socket.data.deviceId = deviceId;

            socket.emit("approval-pending", {
                message: "Waiting for Host Approval",
            });

            notifyHost(cleanRoomId, "device-approval-request", {
                deviceId,
                deviceName,
            });

            console.log(
                `${deviceName} requested access to ${cleanRoomId}`,
            );
        } catch (error) {
            console.error("Join Room Error:", error);

            socket.emit("room-error", "Unable to join room");
        }
    });

    // =============================
    // APPROVE DEVICE
    // =============================

    socket.on("approve-device", async ({ deviceId: targetDeviceId }) => {
        try {
            const hostInfo = getDeviceBySocket(socket);

            if (!hostInfo) return;

            const { roomId, state } = hostInfo;

            if (state.hostDeviceId !== socket.data.deviceId) {
                socket.emit("host-action-error", "Only host can approve devices");
                return;
            }

            const request = state.requests.get(targetDeviceId);

            if (!request) return;

            const targetSocket = io.sockets.sockets.get(request.socketId);

            if (!targetSocket || !targetSocket.connected) {
                state.requests.delete(targetDeviceId);
                broadcastDevices(roomId);
                return;
            }

            state.requests.delete(targetDeviceId);

            state.devices.set(targetDeviceId, {
                deviceId: targetDeviceId,
                deviceName: request.deviceName,
                sockets: new Set([targetSocket.id]),
            });

            targetSocket.data.roomId = roomId;
            targetSocket.data.deviceId = targetDeviceId;

            targetSocket.join(roomId);

            const room = await Room.findOne({ roomId });

            targetSocket.emit("room-joined", {
                roomId,
                roomName: room?.roomName || "My Shared Room",
                deviceId: targetDeviceId,
                deviceName: request.deviceName,
            });

            targetSocket.emit("approval-granted", {
                message: "Host approved your request",
            });

            broadcastDevices(roomId);

            console.log(
                `${request.deviceName} approved for room ${roomId}`,
            );
        } catch (error) {
            console.error("Approve Device Error:", error);

            socket.emit("host-action-error", "Unable to approve device");
        }
    });

    // =============================
    // REJECT DEVICE
    // =============================

    socket.on("reject-device", ({ deviceId: targetDeviceId }) => {
        const hostInfo = getDeviceBySocket(socket);

        if (!hostInfo) return;

        const { roomId, state } = hostInfo;

        if (state.hostDeviceId !== socket.data.deviceId) {
            socket.emit("host-action-error", "Only host can reject devices");
            return;
        }

        const request = state.requests.get(targetDeviceId);

        if (!request) return;

        const targetSocket = io.sockets.sockets.get(request.socketId);

        if (targetSocket) {
            targetSocket.emit("approval-rejected", {
                message: "Your room access request was rejected",
            });

            targetSocket.data.roomId = null;
            targetSocket.data.deviceId = null;
        }

        state.requests.delete(targetDeviceId);

        console.log(
            `Device ${targetDeviceId} rejected from ${roomId}`,
        );
    });

    // =============================
    // HOST REMOVE DEVICE
    // =============================

    socket.on(
        "host-remove-device",
        ({ deviceId: targetDeviceId }) => {
            const hostInfo = getDeviceBySocket(socket);

            if (!hostInfo) return;

            const { roomId, state } = hostInfo;

            if (state.hostDeviceId !== socket.data.deviceId) {
                socket.emit("host-action-error", "Only host can remove devices");
                return;
            }

            if (targetDeviceId === state.hostDeviceId) {
                socket.emit(
                    "host-action-error",
                    "Host device cannot be removed",
                );
                return;
            }

            const targetDevice = state.devices.get(targetDeviceId);

            if (!targetDevice) return;

            state.removedDevices.add(targetDeviceId);
            state.devices.delete(targetDeviceId);

            targetDevice.sockets.forEach((socketId) => {
                const targetSocket = io.sockets.sockets.get(socketId);

                if (targetSocket) {
                    targetSocket.emit("device-removed", {
                        message: "Host removed you from this room",
                    });

                    targetSocket.leave(roomId);

                    targetSocket.data.roomId = null;
                    targetSocket.data.deviceId = null;
                }
            });

            broadcastDevices(roomId);

            console.log(
                `Device ${targetDeviceId} removed from ${roomId}`,
            );
        },
    );

    // =============================
    // LEAVE ROOM
    // =============================

    socket.on("leave-room", () => {
        const roomId = socket.data.roomId;

        if (!roomId) return;

        removeSocketFromRoom(socket);

        console.log(`Socket ${socket.id} left room ${roomId}`);
    });

    // =============================
    // DISCONNECT
    // =============================

    socket.on("disconnect", () => {
        console.log("Socket Disconnected:", socket.id);

        removeSocketFromRoom(socket);
    });
});

// ===============================
// API ROUTES
// ===============================

app.use("/api/rooms", roomRoutes);
app.use("/api/files", fileRoutes);

// ===============================
// HEALTH CHECK
// ===============================

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "ShareRoom Server is Running",
    });
});

// ===============================
// ERROR HANDLER
// ===============================

app.use((error, req, res, next) => {
    console.error("Server Error:", error);

    res.status(error.status || 500).json({
        success: false,
        message: error.message || "Internal Server Error",
    });
});

// ===============================
// DATABASE + SERVER START
// ===============================

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();

        server.listen(PORT, "0.0.0.0", () => {
            console.log(`ShareRoom Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Server Startup Error:", error);
        process.exit(1);
    }
};

startServer();
