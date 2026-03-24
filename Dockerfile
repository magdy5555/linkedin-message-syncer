FROM apify/actor-node-playwright:20

# ضبط مجلد العمل
WORKDIR /usr/src/app

# نسخ الملفات الأساسية أولاً
COPY package*.json ./

# تثبيت المكتبات (نحن نستخدم الصورة الرسمية فهي مجهزة بالـ Browsers)
RUN npm install --omit=dev --audit=false

# نسخ باقي الكود
COPY . ./

# تشغيل الأكتور
CMD ["npm", "start"]
