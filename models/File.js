const {model, Schema, ObjectId} = require('mongoose')


const File = new Schema({
    name: {type: String, required: true},
    type: {type: String, required: true},
    accessLink: {type:String},
    size: {type: Number, default: 0},
    path: {type: String, default: ''}, // путь к файлу
    date: {type: Date, default: Date.now()},
    user: {type: ObjectId, ref: 'User'}, // ссылка на пользоват, котор добавил файл
    parent: {type: ObjectId, ref: 'File'}, // на файл, папку, в которой находится
    childs: [{type: ObjectId, ref: 'File'}], // ссыл на все файлны внутри папки
})

module.exports = model('File', File)