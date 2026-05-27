// /api/douban-img.js

export default async function handler(req, res) {
    // 1. 设置允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: '缺少图片 URL 参数' });
    }

    try {
        // 2. 使用原生 fetch 请求豆瓣图片，伪装身份
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Referer': 'https://movie.douban.com/', 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            console.error(`豆瓣拒绝了请求: ${response.status} - ${url}`);
            return res.status(response.status).json({ error: '豆瓣防盗链拦截' });
        }

        // 3. 将图片流转换为安全的 Buffer 数据（Vercel 极其喜欢这种方式）
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 4. 获取实际的图片类型（比如 image/jpeg, image/webp）
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        // 5. 设置响应头并输出图片
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400');
        res.status(200).send(buffer);

    } catch (error) {
        console.error('获取图片时发生严重错误:', error);
        res.status(500).json({ error: error.message || '服务器内部错误' });
    }
}