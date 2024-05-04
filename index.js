const express = require("express")
const mongoose = require("mongoose")
const router = require("./routes/index")
const config = require("config")
const fileUpload = require("express-fileupload") // для работы с файлами
const errorHandler = require("./middleware/ErrorHendMiddleware")
const corsMiddleware = require("./middleware/corsMiddleware")
const filePathMiddleware = require("./middleware/filepathMiddleware")
const staticPathMiddleware = require("./middleware/staticpathMiddleware")
const cors = require('cors');
const path = require('path')

const app = express()
const PORT = process.env.PORT || config.get('serverPort') // получаем порт

app.use(cors())
app.use(corsMiddleware)
app.use(filePathMiddleware(path.resolve(__dirname, 'files')))
app.use(staticPathMiddleware(path.resolve(__dirname, 'static')))
app.use(fileUpload({
    defCharset: 'utf8',
    defParamCharset: 'utf8'
}))
app.use(express.json())
app.use(express.static(path.resolve(__dirname, 'static')))
app.use('/api', router)

// Обработка ошибок в конце, последний мидлвеир, next не нужет
app.use(errorHandler)

const start = async () => {
    try {
        await mongoose.connect(config.get("dbUrl"))

        app.listen(PORT, () => {
            console.log('Server started on port', PORT)
        })
    } catch (e) {

    }
}

start()