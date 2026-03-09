const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const router = express.Router();
const s3 = require("../config/s3");

// Helper function to execute Python script
const executePythonScript = (scriptName, args = []) => {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [
      path.join(__dirname, '../scripts', scriptName),
      ...args
    ]);

    let result = '';
    let error = '';

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(result));
        } catch (err) {
          resolve(result);
        }
      } else {
        reject(new Error(`Python script failed: ${error}`));
      }
    });
  });
};

// Generate video analysis report
router.post("/generate-video-report", async (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { videoKeys, reportType, analysisParameters } = req.body;
    const username = req.session.username;

    // Security: Verify user owns the videos
    for (const key of videoKeys) {
      if (!key.startsWith(`InterviewAns/${username}/`)) {
        return res.status(403).json({ 
          error: "Access denied to one or more videos" 
        });
      }
    }

    // Get S3 URLs for the videos
    const videoUrls = await Promise.all(
      videoKeys.map(async (key) => {
        const url = await s3.getSignedUrlPromise('getObject', {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: key,
          Expires: 3600
        });
        return { key, url };
      })
    );

    // Prepare data for Python script
    const pythonData = {
      video_urls: videoUrls,
      report_type: reportType,
      parameters: analysisParameters,
      username: username,
      timestamp: new Date().toISOString()
    };

    // Execute Python analysis script
    const reportResult = await executePythonScript(
      'video_analysis.py', 
      [JSON.stringify(pythonData)]
    );

    // Optionally save report to S3
    if (reportResult.report_content) {
      const reportKey = `reports/${username}/${Date.now()}_analysis_report.json`;
      
      await s3.putObject({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: reportKey,
        Body: JSON.stringify(reportResult, null, 2),
        ContentType: 'application/json'
      }).promise();

      reportResult.s3_report_key = reportKey;
    }

    res.status(200).json({
      success: true,
      message: "Report generated successfully",
      report: reportResult
    });

  } catch (err) {
    console.error("Report generation error:", err);
    res.status(500).json({ 
      error: err.message,
      details: "Failed to generate report" 
    });
  }
});

// Generate summary report for user's videos
router.post("/generate-summary-report", async (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { startDate, endDate, subjectFilter } = req.body;
    const username = req.session.username;

    // Get user's videos from S3 (similar to your existing logic)
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `InterviewAns/${username}/`,
      Delimiter: '/'
    };

    const result = await s3.listObjectsV2(params).promise();
    let videoData = [];

    // Process video metadata (simplified version of your existing logic)
    if (result.CommonPrefixes) {
      for (const prefix of result.CommonPrefixes) {
        const subjectPrefix = prefix.Prefix;
        const subject = subjectPrefix.split('/')[2];
        
        if (!subjectFilter || subject === subjectFilter) {
          const subjectParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Prefix: subjectPrefix
          };
          
          const subjectObjects = await s3.listObjectsV2(subjectParams).promise();
          
          if (subjectObjects.Contents) {
            for (const obj of subjectObjects.Contents) {
              if (obj.Key.endsWith('.mp4')) {
                // Apply date filter if provided
                const videoDate = new Date(obj.LastModified);
                if (
                  (!startDate || videoDate >= new Date(startDate)) &&
                  (!endDate || videoDate <= new Date(endDate))
                ) {
                  videoData.push({
                    key: obj.Key,
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
    }

    // Execute Python summary script
    const summaryReport = await executePythonScript(
      'generate_summary.py',
      [JSON.stringify({
        video_metadata: videoData,
        username: username,
        date_range: { startDate, endDate },
        filters: { subjectFilter }
      })]
    );

    res.status(200).json({
      success: true,
      message: "Summary report generated",
      summary: summaryReport,
      video_count: videoData.length
    });

  } catch (err) {
    console.error("Summary report error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get previously generated reports
router.get("/user-reports", async (req, res) => {
  try {
    if (!req.session.loggedIn) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const username = req.session.username;
    
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `reports/${username}/`
    };

    const result = await s3.listObjectsV2(params).promise();
    
    const reports = result.Contents ? result.Contents.map(obj => ({
      key: obj.Key,
      lastModified: obj.LastModified,
      size: obj.Size,
      filename: obj.Key.split('/').pop(),
      downloadUrl: s3.getSignedUrl('getObject', {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: obj.Key,
        Expires: 3600
      })
    })) : [];

    res.status(200).json({
      success: true,
      reports: reports,
      count: reports.length
    });

  } catch (err) {
    console.error("Error fetching reports:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;