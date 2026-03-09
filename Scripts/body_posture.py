# posture_analysis_improved.py
import cv2
import mediapipe as mp
import numpy as np
import json
import sys
import base64
from typing import Dict, List, Tuple, Optional
import math

class PostureAnalyzer:
    """Main class for posture analysis using MediaPipe"""
    
    def __init__(self):
        """Initialize MediaPipe components"""
        self.mp_pose = mp.solutions.pose
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles
        
        # Pose detection model
        self.pose = self.mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            model_complexity=1,
            enable_segmentation=False,
            smooth_landmarks=True
        )
        
        # Constants
        self.IDEAL_SHOULDER_ANGLE = 95
    
    def calculate_angle(self, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
        """Calculate angle between three points"""
        ba = a - b
        bc = c - b
        
        cosine_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc))
        angle = np.arccos(np.clip(cosine_angle, -1.0, 1.0))
        
        return np.degrees(angle)
    
    def calculate_distance(self, point1: Tuple[float, float], point2: Tuple[float, float]) -> float:
        """Calculate Euclidean distance between two points"""
        return math.sqrt((point2[0] - point1[0])**2 + (point2[1] - point1[1])**2)
    
    def get_landmark_coords(self, landmarks, landmark_idx: int, image_shape: Tuple[int, int]) -> Tuple[float, float]:
        """Convert normalized landmark to pixel coordinates"""
        h, w = image_shape
        landmark = landmarks[landmark_idx]
        return (landmark.x * w, landmark.y * h)
    
    def analyze_frame(self, frame: np.ndarray) -> Optional[Dict]:
        """Analyze posture from a single frame"""
        if frame is None:
            return None
        
        # Convert to RGB
        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Process with MediaPipe
        results = self.pose.process(image_rgb)
        
        if not results.pose_landmarks:
            return {
                "Shoulder Angle": "0°",
                "Posture Score": "0%",
                "Alignment": "No Person",
                "Confidence": "0%"
            }
        
        h, w = frame.shape[:2]
        landmarks = results.pose_landmarks.landmark
        
        try:
            # Get shoulder and hip landmarks
            left_shoulder = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.LEFT_SHOULDER.value, (h, w))
            right_shoulder = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.RIGHT_SHOULDER.value, (h, w))
            left_hip = self.get_landmark_coords(landmarks, self.mp_pose.PoseLandmark.LEFT_HIP.value, (h, w))
            
            # Calculate shoulder angle (using left side as reference)
            angle = self.calculate_angle(
                np.array(left_shoulder),
                np.array(left_hip),
                np.array(right_shoulder)
            )
            
            # Calculate posture score (0-100)
            angle_diff = abs(angle - self.IDEAL_SHOULDER_ANGLE)
            posture_score = max(0, 100 - angle_diff)
            
            # Calculate shoulder levelness
            shoulder_height_diff = abs(left_shoulder[1] - right_shoulder[1])
            
            # Determine alignment
            if posture_score >= 85 and shoulder_height_diff < 20:
                alignment = "Excellent"
            elif posture_score >= 70 and shoulder_height_diff < 30:
                alignment = "Good"
            elif posture_score >= 50:
                alignment = "Fair"
            else:
                alignment = "Needs Improvement"
            
            # Calculate confidence based on key point visibility
            confidence = 0
            key_points = [
                self.mp_pose.PoseLandmark.LEFT_SHOULDER,
                self.mp_pose.PoseLandmark.RIGHT_SHOULDER,
                self.mp_pose.PoseLandmark.LEFT_HIP,
                self.mp_pose.PoseLandmark.RIGHT_HIP,
                self.mp_pose.PoseLandmark.NOSE
            ]
            
            visible_count = 0
            for point in key_points:
                lm = landmarks[point.value]
                if lm.visibility > 0.5:
                    visible_count += 1
            
            confidence = (visible_count / len(key_points)) * 100
            
            # Return the exact format expected by frontend
            return {
                "Shoulder Angle": f"{int(angle)}°",
                "Posture Score": f"{int(posture_score)}%",
                "Alignment": alignment,
                "Confidence": f"{int(confidence)}%"
            }
            
        except Exception as e:
            print(f"Error in analysis: {e}", file=sys.stderr)
            return {
                "Shoulder Angle": "0°",
                "Posture Score": "0%",
                "Alignment": "Error",
                "Confidence": "0%"
            }
    
    def analyze_base64_image(self, image_base64: str) -> str:
        """Analyze posture from base64 encoded image string"""
        try:
            # Remove data URL prefix if present
            if ',' in image_base64:
                image_base64 = image_base64.split(',')[1]
            
            # Decode base64 to image
            image_bytes = base64.b64decode(image_base64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None:
                return json.dumps({
                    "Shoulder Angle": "0°",
                    "Posture Score": "0%",
                    "Alignment": "Image Error",
                    "Confidence": "0%"
                })
            
            # Analyze frame
            result = self.analyze_frame(frame)
            
            if result is None:
                return json.dumps({
                    "Shoulder Angle": "0°",
                    "Posture Score": "0%",
                    "Alignment": "No Person Detected",
                    "Confidence": "0%"
                })
            
            return json.dumps(result)
            
        except Exception as e:
            print(f"Error in analyze_base64_image: {e}", file=sys.stderr)
            return json.dumps({
                "Shoulder Angle": "0°",
                "Posture Score": "0%",
                "Alignment": "Analysis Error",
                "Confidence": "0%"
            })

# Global analyzer instance for reuse
_analyzer = None

def get_analyzer():
    """Get or create analyzer instance (singleton pattern)"""
    global _analyzer
    if _analyzer is None:
        _analyzer = PostureAnalyzer()
    return _analyzer

def analyze_posture_base64(image_base64: str) -> str:
    """Main function for external use"""
    analyzer = get_analyzer()
    return analyzer.analyze_base64_image(image_base64)

# Command line interface
if __name__ == "__main__":
    try:
        # Read image data from stdin instead of command line
        if not sys.stdin.isatty():  # Check if stdin has data
            image_base64 = sys.stdin.read().strip()
            
            if image_base64:
                # Call your actual analysis function
                result_json = analyze_posture_base64(image_base64)
                print(result_json)
            else:
                # No image provided, return test data
                print(json.dumps({
                    "Shoulder Angle": "95°",
                    "Posture Score": "85%",
                    "Alignment": "Test Mode",
                    "Confidence": "90%"
                }))
        else:
            # If called without stdin data (for testing)
            print(json.dumps({
                "Shoulder Angle": "95°",
                "Posture Score": "85%",
                "Alignment": "Test Mode",
                "Confidence": "90%"
            }))
        
    except Exception as e:
        print(json.dumps({
            "Shoulder Angle": "0°",
            "Posture Score": "0%",
            "Alignment": "Python Crash",
            "Confidence": "0%",
            "error": str(e)
        }))