const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }

  async sendAnalysisReport(email, username, reportPath, analysisResults) {
    try {
      const reportFilename = path.basename(reportPath);
      
      const mailOptions = {
        from: `"Interview Analyzer" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: email,
        subject: `Your Interview Analysis Report - ${new Date().toLocaleDateString()}`,
        html: this._createEmailTemplate(username, analysisResults),
        attachments: [
          {
            filename: reportFilename,
            path: reportPath,
            contentType: 'application/pdf'
          }
        ]
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
      
    } catch (error) {
      console.error('Email sending error:', error);
      return { success: false, error: error.message };
    }
  }

  _createEmailTemplate(username, results) {
    const overallScore = results.overall?.score_10 || 0;
    const grade = results.overall?.grade || 'N/A';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0A66C2, #00A0DC); 
                    color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; }
          .score-box { background: white; padding: 20px; border-radius: 8px; 
                      box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin: 20px 0; 
                      text-align: center; }
          .score-value { font-size: 36px; font-weight: bold; color: #0A66C2; }
          .category { display: flex; justify-content: space-between; 
                     margin: 10px 0; padding: 10px; background: white; 
                     border-radius: 5px; }
          .category-name { font-weight: bold; }
          .category-score { color: #0A66C2; font-weight: bold; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; 
                   color: #666; font-size: 12px; text-align: center; }
          .btn { display: inline-block; padding: 12px 30px; background: #0A66C2; 
                color: white; text-decoration: none; border-radius: 5px; 
                margin-top: 20px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Interview Analysis Report</h1>
            <p>Your comprehensive performance evaluation</p>
          </div>
          
          <div class="content">
            <h2>Hello ${username},</h2>
            <p>Your interview analysis has been completed. Here's a summary of your performance:</p>
            
            <div class="score-box">
              <div class="score-value">${overallScore}/10</div>
              <p><strong>Overall Grade:</strong> ${grade}</p>
              <p><strong>Performance Level:</strong> ${results.overall?.performance_level || 'N/A'}</p>
              <p>${results.overall?.summary || ''}</p>
            </div>
            
            <h3>Category Scores:</h3>
            ${this._createCategoryScoresHTML(results)}
            
            <h3>Key Strengths:</h3>
            <ul>
              ${results.overall?.strengths?.slice(0, 3).map(s => 
                `<li><strong>${s[0]}:</strong> ${s[1]}</li>`).join('') || '<li>No specific strengths identified</li>'}
            </ul>
            
            <h3>Areas for Improvement:</h3>
            <ul>
              ${results.overall?.improvements?.slice(0, 3).map(i => 
                `<li><strong>${i[0]}:</strong> ${i[1]}</li>`).join('') || '<li>No specific improvements identified</li>'}
            </ul>
            
            <p>Your detailed analysis report is attached to this email. Review it to understand your performance better and identify areas for improvement.</p>
            
            <div style="text-align: center;">
              <a href="#" class="btn">View Detailed Report</a>
            </div>
            
            <p><strong>Tips for next time:</strong></p>
            <ul>
              <li>Practice maintaining eye contact with the camera</li>
              <li>Record yourself regularly to track progress</li>
              <li>Focus on one improvement area at a time</li>
            </ul>
          </div>
          
          <div class="footer">
            <p>This report was generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
            <p>Confidential - For ${username}'s personal use only</p>
            <p>&copy; ${new Date().getFullYear()} Interview Analyzer. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  _createCategoryScoresHTML(results) {
    const categories = [
      { name: 'Posture', key: 'posture' },
      { name: 'Facial Expression', key: 'facial' },
      { name: 'Eye Contact', key: 'eye_contact' },
      { name: 'Voice Quality', key: 'voice' },
      { name: 'Language Skills', key: 'language' }
    ];
    
    return categories.map(cat => `
      <div class="category">
        <span class="category-name">${cat.name}</span>
        <span class="category-score">${results[cat.key]?.score_10?.toFixed(1) || 'N/A'}/10</span>
      </div>
    `).join('');
  }
}

module.exports = new EmailService();