
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const File = require("../models/File");
const Room = require("../models/Room");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads");

// =====================================
// CREATE UPLOAD DIRECTORY
// =====================================

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// =====================================
// MULTER STORAGE
// =====================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        cb(null, randomUUID());
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 500 * 1024 * 1024
    }
});

// =====================================
// PREVIEW SUPPORTED MIME TYPES
// =====================================

const previewMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
    "video/mp4",
    "video/webm",
    "video/ogg"
];

// =====================================
// UPLOAD FILE
// =====================================

router.post("/upload", upload.single("file"), async (req, res) => {

    try {

        const { roomId, uploadedBy } = req.body;

        if (!roomId || !req.file) {

            if (req.file?.path && fs.existsSync(req.file.path)) {
                await fs.promises.unlink(req.file.path);
            }

            return res.status(400).json({
                success: false,
                message: "Room ID and file are required"
            });

        }

        const cleanRoomId = String(roomId)
            .trim()
            .toUpperCase();

        const room = await Room.findOne({
            roomId: cleanRoomId,
            active: true
        });

        if (!room) {

            await fs.promises.unlink(req.file.path);

            return res.status(404).json({
                success: false,
                message: "Room not found"
            });

        }

        const savedFile = await File.create({

            roomId: room.roomId,

            originalName: path.basename(
                req.file.originalname
            ),

            storedName: req.file.filename,

            size: req.file.size,

            mimeType: req.file.mimetype,

            uploadedBy: uploadedBy || "Unknown Device"

        });

        const io = req.app.get("io");

        io.to(room.roomId).emit(
            "file-shared",
            savedFile
        );

        return res.status(201).json({
            success: true,
            message: "File uploaded successfully",
            file: savedFile
        });

    } catch (error) {

        if (req.file?.path && fs.existsSync(req.file.path)) {
            await fs.promises.unlink(req.file.path).catch(() => { });
        }

        console.error("Upload Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to upload file"
        });

    }

});

// =====================================
// GET ROOM FILES
// =====================================

router.get("/room/:roomId", async (req, res) => {

    try {

        const roomId = req.params.roomId
            .trim()
            .toUpperCase();

        const room = await Room.findOne({
            roomId,
            active: true
        });

        if (!room) {

            return res.status(404).json({
                success: false,
                message: "Room not found"
            });

        }

        const files = await File.find({ roomId })
            .sort({ uploadedAt: -1 });

        return res.json({
            success: true,
            files
        });

    } catch (error) {

        console.error("Get Files Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch files"
        });

    }

});

// =====================================
// PREVIEW FILE
// =====================================

router.get("/preview/:id", async (req, res) => {

    try {

        const file = await File.findById(req.params.id);

        if (!file) {

            return res.status(404).json({
                success: false,
                message: "File not found"
            });

        }

        if (!previewMimeTypes.includes(file.mimeType)) {

            return res.status(415).json({
                success: false,
                message: "Preview is not supported for this file type"
            });

        }

        const filePath = path.join(
            uploadDir,
            file.storedName
        );

        if (!fs.existsSync(filePath)) {

            return res.status(404).json({
                success: false,
                message: "Physical file not found"
            });

        }

        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("X-Content-Type-Options", "nosniff");

        return res.sendFile(filePath);

    } catch (error) {

        console.error("Preview Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to preview file"
        });

    }

});

// =====================================
// DELETE FILE - HOST ONLY
// =====================================

router.delete("/:id", async (req, res) => {

    try {

        const { roomId, deviceId } = req.body;

        if (!roomId || !deviceId) {

            return res.status(400).json({
                success: false,
                message: "Room ID and device ID are required"
            });

        }

        const cleanRoomId = String(roomId)
            .trim()
            .toUpperCase();

        const cleanDeviceId = String(deviceId).trim();

        // Verify room
        const room = await Room.findOne({
            roomId: cleanRoomId,
            active: true
        });

        if (!room) {

            return res.status(404).json({
                success: false,
                message: "Room not found"
            });

        }

        // Get active room state
        const roomStates = req.app.get("roomStates");

        const state = roomStates?.get(cleanRoomId);

        // Verify host
        if (
            !state ||
            state.hostDeviceId !== cleanDeviceId
        ) {

            return res.status(403).json({
                success: false,
                message: "Only the room host can delete files"
            });

        }

        // Verify host is connected
        const host = state.devices.get(cleanDeviceId);

        if (!host || host.sockets.size === 0) {

            return res.status(403).json({
                success: false,
                message: "Host is not connected"
            });

        }

        // Find file inside the requested room
        const file = await File.findOne({
            _id: req.params.id,
            roomId: cleanRoomId
        });

        if (!file) {

            return res.status(404).json({
                success: false,
                message: "File not found in this room"
            });

        }

        // Delete physical file
        const filePath = path.join(
            uploadDir,
            file.storedName
        );

        try {

            await fs.promises.unlink(filePath);

        } catch (error) {

            if (error.code !== "ENOENT") {
                throw error;
            }

        }

        // Delete MongoDB metadata
        await File.deleteOne({
            _id: file._id
        });

        // Notify all connected room devices
        const io = req.app.get("io");

        io.to(cleanRoomId).emit("file-deleted", {
            fileId: file._id.toString()
        });

        return res.json({
            success: true,
            message: "File deleted successfully"
        });

    } catch (error) {

        console.error("Delete File Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to delete file"
        });

    }

});

// =====================================
// DOWNLOAD FILE
// =====================================

router.get("/download/:id", async (req, res) => {

    try {

        const file = await File.findById(req.params.id);

        if (!file) {

            return res.status(404).json({
                success: false,
                message: "File not found"
            });

        }

        const filePath = path.join(
            uploadDir,
            file.storedName
        );

        if (!fs.existsSync(filePath)) {

            return res.status(404).json({
                success: false,
                message: "Physical file not found"
            });

        }

        return res.download(
            filePath,
            file.originalName
        );

    } catch (error) {

        console.error("Download Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to download file"
        });

    }

});

module.exports = router;
