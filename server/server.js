
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

const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(",").map((url) => url.trim())
    : ["http://localhost:5173"];

app.use(
    cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
});

const roomStates = new Map();

app.set("roomStates", roomStates);

// --------------------------------------------------
// ROOM HELPERS
// --------------------------------------------------

function getRoomState(roomId) {
    if (!roomStates.has(roomId)) {
        roomStates.set(roomId, {
            devices: [],
            hostDeviceId: null,
            removedDevices: [],
            requests: [],
            closing: false,
        });
    }

    return roomStates.get(roomId);
}

function getOnlineDevices(roomId) {
    const state = roomStates.get(roomId);

    if (!state) return [];

    return state.devices;
}

function broadcastDevices(roomId) {
    const state = roomStates.get(roomId);

    if (!state) return;

    const devices = state.devices.map((device) => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        isHost: device.deviceId === state.hostDeviceId,
    }));

    io.to(roomId).emit("device-list", devices);
    io.to(roomId).emit("device-count", devices.length);
}

function getDeviceBySocket(state, socketId) {
    return state.devices.find(
        (device) => device.socketId === socketId
    );
}

// --------------------------------------------------
// HOST TRANSFER
// --------------------------------------------------

function transferHost(roomId) {
    const state = roomStates.get(roomId);

    if (!state || state.devices.length === 0) {
        return;
    }

    const newHost = state.devices[0];

    state.hostDeviceId = newHost.deviceId;

    io.to(roomId).emit("host-changed", {
        hostDeviceId: newHost.deviceId,
        hostName: newHost.deviceName,
    });

    broadcastDevices(roomId);
}

// --------------------------------------------------
// NOTIFY HOST
// --------------------------------------------------

function notifyHost(roomId) {
    const state = roomStates.get(roomId);

    if (!state || !state.hostDeviceId) return;

    const host = state.devices.find(
        (device) => device.deviceId === state.hostDeviceId
    );

    if (!host) return;

    const hostSocket = io.sockets.sockets.get(host.socketId);

    if (hostSocket) {
        hostSocket.emit("device-approval-request", {
            requests: state.requests,
        });
    }
}

// --------------------------------------------------
// DELETE ROOM COMPLETELY
// Only called when the LAST member leaves
// --------------------------------------------------

async function deleteRoomCompletely(roomId) {
    const state = roomStates.get(roomId);

    if (!state || state.closing) return;

    state.closing = true;

    try {
        console.log(`Deleting empty room: ${roomId}`);

        // Disconnect pending approval sockets
        for (const request of state.requests) {
            const pendingSocket = io.sockets.sockets.get(
                request.socketId
            );

            if (pendingSocket) {
                pendingSocket.emit("room-closed", {
                    message: "This room has been closed.",
                });

                pendingSocket.leave(roomId);
            }
        }

        // Get all files belonging to this room
        const roomFiles = await File.find({ roomId });

        const uploadDirectory = path.join(__dirname, "uploads");

        // Delete uploaded files from disk
        for (const file of roomFiles) {
            const storedName = path.basename(file.storedName);
            const filePath = path.join(uploadDirectory, storedName);

            try {
                await fs.promises.unlink(filePath);
            } catch (error) {
                if (error.code !== "ENOENT") {
                    console.error("File deletion error:", error.message);
                }
            }
        }

        // Delete file records from MongoDB
        await File.deleteMany({ roomId });

        // Delete room record from MongoDB
        await Room.deleteOne({ roomId });

        // Notify connected clients
        io.to(roomId).emit("room-closed", {
            message: "Room has been closed.",
        });

        // Remove socket room membership
        const sockets = await io.in(roomId).fetchSockets();

        for (const socket of sockets) {
            socket.leave(roomId);
        }

        // Remove in-memory room state
        roomStates.delete(roomId);

        console.log(`Room ${roomId} deleted successfully`);
    } catch (error) {
        console.error("Room cleanup error:", error);

        // Allow cleanup to be retried if it failed
        state.closing = false;
    }
}

// --------------------------------------------------
// REMOVE SOCKET FROM ROOM
// --------------------------------------------------

async function removeSocketFromRoom(socket, reason = "leave") {
    const roomId = socket.data.roomId;
    const deviceId = socket.data.deviceId;

    if (!roomId || !deviceId) return;

    const state = roomStates.get(roomId);

    if (!state || state.closing) return;

    // Remove pending request if it exists
    state.requests = state.requests.filter(
        (request) => request.deviceId !== deviceId
    );

    const device = state.devices.find(
        (item) => item.deviceId === deviceId
    );

    if (!device) {
        socket.leave(roomId);
        socket.data.roomId = null;
        socket.data.deviceId = null;

        notifyHost(roomId);
        return;
    }

    const wasHost = state.hostDeviceId === deviceId;

    state.devices = state.devices.filter(
        (item) => item.deviceId !== deviceId
    );

    socket.leave(roomId);

    socket.data.roomId = null;
    socket.data.deviceId = null;

    // Notify remaining members
    io.to(roomId).emit("device-removed", {
        deviceId,
        deviceName: device.deviceName,
        reason,
    });

    // LAST MEMBER LEFT
    if (state.devices.length === 0) {
        await deleteRoomCompletely(roomId);
        return;
    }

    // Transfer host if the host leaves
    if (wasHost) {
        transferHost(roomId);
    } else {
        broadcastDevices(roomId);
    }

    notifyHost(roomId);
}

// --------------------------------------------------
// JOIN ROOM
// --------------------------------------------------

io.on("connection", (socket) => {
    console.log("Device connected:", socket.id);

    socket.on("join-room", async (data) => {
        try {
            const cleanRoomId = String(data.roomId || "")
                .trim()
                .toUpperCase();

            const deviceId = String(data.deviceId || "").trim();

            const deviceName = String(
                data.deviceName || "Unknown Device"
            ).trim();

            if (!cleanRoomId || !deviceId) {
                socket.emit("room-error", {
                    message: "Invalid room details.",
                });
                return;
            }

            const room = await Room.findOne({
                roomId: cleanRoomId,
            });

            if (!room) {
                socket.emit("room-error", {
                    message: "Room not found.",
                });
                return;
            }

            const state = getRoomState(cleanRoomId);

            if (state.closing) {
                socket.emit("room-error", {
                    message: "Room is being closed. Try again later.",
                });
                return;
            }

            // Avoid joining another room without leaving the old one
            if (
                socket.data.roomId &&
                socket.data.roomId !== cleanRoomId
            ) {
                await removeSocketFromRoom(socket, "switch-room");
            }

            // Check whether device was removed earlier
            if (state.removedDevices.includes(deviceId)) {
                socket.emit("room-error", {
                    message: "You have been removed from this room.",
                });
                return;
            }

            // Existing device reconnect
            const existingDevice = state.devices.find(
                (device) => device.deviceId === deviceId
            );

            if (existingDevice) {
                const oldSocket = io.sockets.sockets.get(
                    existingDevice.socketId
                );

                if (oldSocket && oldSocket.id !== socket.id) {
                    oldSocket.leave(cleanRoomId);
                    oldSocket.data.roomId = null;
                    oldSocket.data.deviceId = null;
                }

                existingDevice.socketId = socket.id;
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
                return;
            }

            // First member becomes host
            if (state.devices.length === 0) {
                state.devices.push({
                    deviceId,
                    deviceName,
                    socketId: socket.id,
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
                return;
            }

            // New device waits for host approval
            const alreadyRequested = state.requests.some(
                (request) => request.deviceId === deviceId
            );

            if (!alreadyRequested) {
                state.requests.push({
                    deviceId,
                    deviceName,
                    socketId: socket.id,
                });
            }

            socket.data.roomId = cleanRoomId;
            socket.data.deviceId = deviceId;

            socket.emit("approval-pending", {
                message: "Waiting for host approval.",
            });

            notifyHost(cleanRoomId);
        } catch (error) {
            console.error("Join room error:", error);

            socket.emit("room-error", {
                message: "Unable to join room.",
            });
        }
    });

    // ------------------------------------------------
    // APPROVE DEVICE
    // ------------------------------------------------

    socket.on("approve-device", async (data) => {
        try {
            const roomId = socket.data.roomId;
            const state = roomStates.get(roomId);

            if (!state || state.closing) return;

            const host = getDeviceBySocket(state, socket.id);

            if (!host || state.hostDeviceId !== host.deviceId) {
                socket.emit("host-action-error", {
                    message: "Only the host can approve devices.",
                });
                return;
            }

            const request = state.requests.find(
                (item) => item.deviceId === data.deviceId
            );

            if (!request) return;

            const pendingSocket = io.sockets.sockets.get(
                request.socketId
            );

            if (!pendingSocket || !pendingSocket.connected) {
                state.requests = state.requests.filter(
                    (item) => item.deviceId !== data.deviceId
                );

                notifyHost(roomId);
                return;
            }

            state.requests = state.requests.filter(
                (item) => item.deviceId !== data.deviceId
            );

            const room = await Room.findOne({ roomId });

            if (!room || state.closing) return;

            state.devices.push({
                deviceId: request.deviceId,
                deviceName: request.deviceName,
                socketId: request.socketId,
            });

            pendingSocket.join(roomId);

            pendingSocket.emit("approval-granted", {
                message: "Your request has been approved.",
            });

            pendingSocket.emit("room-joined", {
                roomId,
                roomName: room.roomName || "My Shared Room",
                deviceId: request.deviceId,
                deviceName: request.deviceName,
            });

            broadcastDevices(roomId);
            notifyHost(roomId);
        } catch (error) {
            console.error("Approve device error:", error);
        }
    });

    // ------------------------------------------------
    // REJECT DEVICE
    // ------------------------------------------------

    socket.on("reject-device", (data) => {
        const roomId = socket.data.roomId;
        const state = roomStates.get(roomId);

        if (!state || state.closing) return;

        const host = getDeviceBySocket(state, socket.id);

        if (!host || state.hostDeviceId !== host.deviceId) return;

        const request = state.requests.find(
            (item) => item.deviceId === data.deviceId
        );

        if (!request) return;

        const pendingSocket = io.sockets.sockets.get(
            request.socketId
        );

        if (pendingSocket) {
            pendingSocket.emit("approval-rejected", {
                message: "Your request was rejected.",
            });

            pendingSocket.data.roomId = null;
            pendingSocket.data.deviceId = null;
        }

        state.requests = state.requests.filter(
            (item) => item.deviceId !== data.deviceId
        );

        notifyHost(roomId);
    });

    // ------------------------------------------------
    // HOST REMOVE DEVICE
    // ------------------------------------------------

    socket.on("host-remove-device", async (data) => {
        const roomId = socket.data.roomId;
        const state = roomStates.get(roomId);

        if (!state || state.closing) return;

        const host = getDeviceBySocket(state, socket.id);

        if (!host || state.hostDeviceId !== host.deviceId) {
            socket.emit("host-action-error", {
                message: "Only the host can remove devices.",
            });
            return;
        }

        const target = state.devices.find(
            (device) => device.deviceId === data.deviceId
        );

        if (!target || target.deviceId === state.hostDeviceId) return;

        state.removedDevices.push(target.deviceId);

        const targetSocket = io.sockets.sockets.get(
            target.socketId
        );

        if (targetSocket) {
            targetSocket.emit("device-removed", {
                deviceId: target.deviceId,
                message: "You have been removed from this room.",
            });

            await removeSocketFromRoom(targetSocket, "removed");
        } else {
            state.devices = state.devices.filter(
                (device) => device.deviceId !== target.deviceId
            );

            broadcastDevices(roomId);
        }
    });

    // ------------------------------------------------
    // LEAVE ROOM
    // ------------------------------------------------

    socket.on("leave-room", async () => {
        await removeSocketFromRoom(socket, "leave");
    });

    // ------------------------------------------------
    // DISCONNECT
    // ------------------------------------------------

    socket.on("disconnect", async () => {
        console.log("Device disconnected:", socket.id);

        await removeSocketFromRoom(socket, "disconnect");
    });
});

// --------------------------------------------------
// API ROUTES
// --------------------------------------------------

app.use("/api/rooms", roomRoutes);
app.use("/api/files", fileRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "ShareRoom Server Running Successfully",
    });
});

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    res.status(500).json({
        message: "Internal Server Error",
    });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`ShareRoom server running on port ${PORT}`);
    });
});
