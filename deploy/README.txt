==================================================
  DeployCenter — הוראות התקנה
==================================================

תכולת ה-ZIP:
  deploycenter-src.zip      קוד המקור
  install.sh                סקריפט התקנה אוטומטי
  .env.prod.template        תבנית קובץ הגדרות
  nginx.conf                הגדרות Nginx
  README.txt                קובץ זה

--------------------------------------------------
דרישות מקדימות על השרת (כבר קיימים):
  ✔ Node.js 18+
  ✔ npm
  ✔ PostgreSQL
  ✔ Nginx
  ✔ PM2 (מותקן אוטומטית אם חסר)
  ✔ גישה לאינטרנט להורדת npm packages
--------------------------------------------------

הוראות:
  1. העתק את כל קבצי ה-ZIP לתיקייה על השרת
     (למשל: /home/user/deploycenter-install/)

  2. הרץ:
     chmod +x install.sh
     sudo bash install.sh

  3. הסקריפט יעצור ויבקש ממך למלא את .env.prod
     מלא את הפרטים הנדרשים (DB, JWT, URL)
     ולחץ ENTER להמשך

  4. ב-nginx.conf — שנה:
     - server_name לכתובת שלך
     - נתיבי SSL לתעודות הנכונות

--------------------------------------------------
אחרי ההתקנה:
  pm2 status                    בדוק שה-backend פועל
  pm2 logs deploycenter-api     ראה logs
  curl localhost:3000/api/auth/config   בדוק API
==================================================
