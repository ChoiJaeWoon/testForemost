const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const archiver = require("archiver");
const http = require("http");
const WebSocket = require("ws");
const app = express();
const port = 3001;

const clients = new Set();

async function clearFolder(folderPath) {
  try {
    const files = await fs.promises.readdir(folderPath);
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        await fs.promises.rmdir(filePath, { recursive: true });
      } else {
        await fs.promises.unlink(filePath);
      }
    }
  } catch (err) {
    console.error(`Error clearing folder ${folderPath}:`, err);
  }
}

async function listFilesInFolder(folderPath, baseFolderPath) {
  let fileList = [];
  const files = await fs.promises.readdir(folderPath, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(folderPath, file.name);
    if (file.isDirectory()) {
      const nestedFiles = await listFilesInFolder(fullPath, baseFolderPath);
      fileList = fileList.concat(nestedFiles);
    } else {
      fileList.push(fullPath.replace(`${baseFolderPath}/`, ""));
    }
  }
  return fileList;
}

async function startServer() {
  app.use(cors());
  app.use(express.json());
  app.use(express.static("public"));

  const tempFolderPath = path.join(__dirname, "temp");
  const outputFolderPath = path.join(__dirname, "output");

  [tempFolderPath, outputFolderPath].forEach((folder) => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder);
    }
    fs.chmodSync(folder, 0o777);
  });

  const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
      await clearFolder(tempFolderPath);
      await clearFolder(outputFolderPath);
      cb(null, tempFolderPath);
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname);
    },
  });
  const upload = multer({ storage: storage });

  app.post("/recover-file", async (req, res) => {
    const files = await fs.promises.readdir(tempFolderPath);
    if (files.length === 0) {
      return res.status(400).send("No file uploaded.");
    }
    const tempFilePath = path.join(tempFolderPath, files[0]);

    try {
      const cmd = `foremost -i ${tempFilePath} -o ${outputFolderPath}`;

      exec(cmd, async (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          console.error(`stderr: ${stderr}`);
          return res
            .status(500)
            .json({ error: "Recovery failed", details: stderr });
        }

        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);

        const zipFilePath = path.join(__dirname, "output.zip");

        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver("zip", {
          zlib: { level: 9 },
        });

        output.on("close", async () => {
          console.log(`ZIP file created: ${archive.pointer()} total bytes`);
          const recoveredFiles = await listFilesInFolder(
            outputFolderPath,
            outputFolderPath
          );
          res.json({ downloadLink: "/download-zip", recoveredFiles });
        });

        archive.on("error", (err) => {
          throw err;
        });

        archive.pipe(output);
        archive.directory(outputFolderPath, false);
        archive.finalize();
      });
    } catch (err) {
      console.error("Failed to process files:", err);

      return res
        .status(500)
        .json({ error: "Internal Server Error", details: err.message });
    }
  });

  app.post("/upload", upload.single("file"), (req, res) => {
    const file = req.file;

    if (!file) {
      return res.status(400).send("No file uploaded.");
    }

    res.status(200).json({ fileName: file.originalname });
  });

  app.post("/delete", async (req, res) => {
    try {
      await clearFolder(tempFolderPath);
      res.status(200).send("파일 삭제 완료");
      broadcastProgress(0); // 초록바 초기화
    } catch (error) {
      console.error("Error clearing temp folder:", error);
      res.status(500).send("Error clearing temp folder");
    }
  });

  app.get("/uploaded-files", async (req, res) => {
    try {
      const files = await listFilesInFolder(tempFolderPath, tempFolderPath);
      res.json({ uploadedFiles: files });
    } catch (error) {
      console.error("Error listing files in temp folder:", error);
      res.status(500).send("Error listing files in temp folder");
    }
  });

  app.post("/perform-action", (req, res) => {
    console.log("Trigger action received:", req.body);
    // 실제 수행할 작업을 여기에 작성합니다.
    res.json({ success: true, message: "Action performed on server 3001" });
    res.send({ message: "Action performed on server 3001" });
  });
  app.get("/download-zip", (req, res) => {
    const zipFilePath = path.join(__dirname, "output.zip");
    if (!fs.existsSync(zipFilePath)) {
      // ZIP 파일이 없으면 생성
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      output.on("close", () => {
        console.log(`ZIP file created: ${archive.pointer()} total bytes`);
        res.download(zipFilePath, "recovered_files.zip");
      });

      archive.on("error", (err) => {
        console.error("Error creating ZIP file:", err);
        res.status(500).send("Error creating ZIP file");
      });

      archive.pipe(output);
      archive.directory(outputFolderPath, false);
      archive.finalize();
    } else {
      res.download(zipFilePath, "recovered_files.zip", (err) => {
        if (err) {
          console.error("Error downloading ZIP file:", err);
          res.status(500).send("Error downloading ZIP file");
        }
      });
    }
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  function broadcastProgress(progress) {
    for (let client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ progress }));
      }
    }
  }

  httpServer.listen(port, () => {
    console.log(`HTTP Server running on port ${port}`);
  });
}

startServer();
