const express = require("express");
const upload = require("../middleware/upload");
const s3 = require("../config/s3");
const router = express.Router();

router.post("/upload-answer", upload.single("video"), (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No video uploaded" });
    }

    res.status(200).json({
      success: true,
      message: "Video uploaded to AWS S3",
      s3Key: req.file.key,
      s3Url: req.file.location
    });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get user's videos
router.get("/user-videos", async (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const username = req.session.username;
    const subjectName = req.query.subjectName || "all";
    
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `InterviewAns/${username}/`,
      Delimiter: '/'
    };

    const result = await s3.listObjectsV2(params).promise();
    
    let videos = [];
    
    if (result.CommonPrefixes) {
      for (const prefix of result.CommonPrefixes) {
        const subjectPrefix = prefix.Prefix;
        const subject = subjectPrefix.split('/')[2]; // Get subject name
        
        if (subjectName === "all" || subject === subjectName) {
          const subjectParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Prefix: subjectPrefix
          };
          
          const subjectObjects = await s3.listObjectsV2(subjectParams).promise();
          
          if (subjectObjects.Contents) {
            for (const obj of subjectObjects.Contents) {
              if (obj.Key.endsWith('.mp4')) {
                // Generate presigned URL for download
                const url = await s3.getSignedUrlPromise('getObject', {
                  Bucket: process.env.AWS_BUCKET_NAME,
                  Key: obj.Key,
                  Expires: 3600 // 1 hour
                });
                
                videos.push({
                  key: obj.Key,
                  url: url,
                  lastModified: obj.LastModified,
                  size: obj.Size,
                  subject: subject,
                  filename: obj.Key.split('/').pop()
                });
              }
            }
          }
        }
      }
    }
    
    // Sort by latest first
    videos.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    res.status(200).json({
      success: true,
      videos: videos,
      count: videos.length
    });

  } catch (err) {
    console.error("Error fetching videos:", err);
    res.status(500).json({ error: err.message });
  }
});

// Download specific video
router.get("/download-video/:key(*)", async (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const key = req.params.key;
    const username = req.session.username;
    
    // Security check: ensure user can only access their own videos
    if (!key.startsWith(`InterviewAns/${username}/`)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    };

    // Get video metadata
    const head = await s3.headObject(params).promise();
    
    // Generate presigned URL
    const url = await s3.getSignedUrlPromise('getObject', {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Expires: 3600, // 1 hour expiry
      ResponseContentDisposition: `attachment; filename="${key.split('/').pop()}"`
    });

    res.status(200).json({
      success: true,
      downloadUrl: url,
      filename: key.split('/').pop(),
      contentType: head.ContentType,
      size: head.ContentLength
    });

  } catch (err) {
    console.error("Download error:", err);
    if (err.code === 'NoSuchKey') {
      return res.status(404).json({ error: "Video not found" });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;