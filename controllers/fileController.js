const fileService = require('../services/fileService')
const config = require('config')
const fs = require('fs')
const User = require('../models/User')
const File = require('../models/File')
const ApiError = require("../error/ApiError");
const Uuid = require('uuid')
const archiver = require('archiver')
const jwt = require('jsonwebtoken')
const path = require('path');

async function deleteChildren(parentId) {
    // Находим все дочерние элементы у файла с указанным parentId
    const children = await File.find({ parent: parentId });

    // Перебираем каждый дочерний элемент
    for (const child of children) {
        // Если у дочернего элемента есть дочерние элементы, рекурсивно удаляем их
        if (child.type === 'dir') {
            await deleteChildren(child._id);
        }
        // Удаляем сам дочерний элемент из базы данных
        await File.deleteOne({ _id: child._id });
    }
}

async function deleteFileAndChildren(fileId) {
    // Удаляем дочерние элементы файла из базы данных
    await deleteChildren(fileId);

    // Удаляем сам файл из базы данных
    await File.deleteOne({ _id: fileId });
}

async function updateParentFolderSize(parentId, fileSize) {
    let parentFolder = await File.findById(parentId);
    if (!parentFolder) return;

    parentFolder.size += fileSize;
    await parentFolder.save();

    // Рекурсивно обновляем родительские папки
    if (parentFolder.parent) {
        await updateParentFolderSize(parentFolder.parent, fileSize);
    }
}

async function updateDeleteParentFolderSize(parentId, fileSize) {
    let parentFolder = await File.findById(parentId);
    if (!parentFolder) return;

    parentFolder.size -= fileSize;
    await parentFolder.save();

    // Рекурсивно обновляем родительские папки
    if (parentFolder.parent) {
        await updateDeleteParentFolderSize(parentFolder.parent, fileSize);
    }
}

const generateJwtToken = (id, email, diskSpace, usedSpace, role, avatar, name, surname) => {
    return jwt.sign(
        {id, email, diskSpace, usedSpace, role, avatar, name, surname},
        config.get("secretKey"),
        {expiresIn: '12h'}
    )
}

async function addFolderToArchive(folderPath, archive, parentFolder = '') {
    if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath);

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            const relativePath = path.join(parentFolder, file); // Относительный путь файла в архиве

            if (fs.lstatSync(filePath).isDirectory()) {
                // Если это папка, рекурсивно добавляем ее содержимое в архив с указанием относительного пути
                await addFolderToArchive(filePath, archive, relativePath);
            } else {
                // Если это файл, добавляем его в архив с указанием относительного пути
                archive.append(fs.createReadStream(filePath), { name: relativePath });
            }
        }
    }
}


function isAllowedFileType(filename) {
    // Список разрешенных расширений файлов
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'txt', 'mp4', 'webm'];

    // Получаем расширение файла
    const extension = filename.split('.').pop().toLowerCase();

    // Проверяем, является ли расширение файла разрешенным
    return allowedExtensions.includes(extension);
}

class FileController {
    async createDir(req, res) {
        try {
            const {name, type, parent} = req.body
            const file = new File({name, type, parent, user: req.user.id})
            const parentFile = await File.findOne({_id: parent})
            // если родительский файл не найден, то добавляем в корневую директорию
            if(!parentFile) {
                file.path = name
                await fileService.createDir(req, file)
            } else {
                file.path = `${parentFile.path}/${file.name}`
                await fileService.createDir(req, file)
                parentFile.childs.push(file._id)
                await parentFile.save()
            }
            await file.save()
            return res.json(file)
        } catch (e) {
            console.log(e)
            return res.status(400).json(e)
        }
    }

    async getFiles(req, res, next) {
        try {
            //искать файлы по id пользователя из токена и родит папк из стр запроса
            const {sort} = req.query
            let files
            switch (sort) {
                case 'name':
                    files = await File.find({user: req.user.id, parent: req.query.parent}).sort({name:1})
                    break
                case 'type':
                    files = await File.find({user: req.user.id, parent: req.query.parent}).sort({type:1})
                    break
                case 'date':
                    files = await File.find({user: req.user.id, parent: req.query.parent}).sort({date:1})
                    break
                default:
                    files = await File.find({user: req.user.id, parent: req.query.parent})
                    break;
            }
            return res.json(files)
        } catch (e) {
            console.log(e)
            return next(ApiError.internal('Файлы не найдены'));
        }
    }

    async  uploadFile(req, res, next) {
        try {
            const file = req.files.file

            const parent = await File.findOne({user: req.user.id, _id: req.body.parent})
            const user = await User.findOne({_id: req.user.id})

            if (user.usedSpace + file.size > user.diskSpace) {
                return next(ApiError.badRequest({message: 'Нет места на диске'}))
            }
            user.usedSpace = user.usedSpace + file.size

            let path;
            if (parent) {
                path = `${req.filePath}/${user._id}/${parent.path}/${file.name}`
                await updateParentFolderSize(parent._id, file.size)
                await parent.save()
            } else {
                path = `${req.filePath}/${user._id}/${file.name}`
            }

            if (fs.existsSync(path)) {
                return next(ApiError.badRequest({message: 'Такой файл уже есть'}))
            }
            file.mv(path)

            const type = file.name.split('.').pop()
            let filePath = file.name
            if (parent) {
                filePath = parent.path + "/" + file.name
            }

            const dbFile = new File({
                name: file.name,
                type,
                size: file.size,
                path: filePath,
                parent: parent ? parent._id : null,
                user: user._id
            });


            await Promise.all([dbFile.save(), user.save()])
            const token = generateJwtToken(user.id, user.email, user.diskSpace, user.usedSpace, user.role, user.avatar, user.name, user.surname)
            res.json({dbFile, usedSpace: user.usedSpace, token})
        } catch (e) {
            console.log(e)
            return next(ApiError.internal({message: 'Ошибка загрузки'}))
        }
    }

    async downloadFile(req, res, next) {
        try {
            const file = await File.findOne({_id: req.query.id, user: req.user.id})
            const path = fileService.getPath(req, file)
            if (fs.existsSync(path)) {
                return res.download(path, file.name)
            }
            return next(ApiError.badRequest({message: "Ошибка загрузки"}))
        } catch (e) {
            console.log(e)
            return next(ApiError.internal({message: "Ошибка загрузки"}))
        }
    }

    async createArchiveAndDownload(req, res) {
        try {
            const file = await File.findById({_id: req.query.id});
            const folderPath = fileService.getPath(req, file);

            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            // Передаем архив в response для скачивания
            res.attachment(`${file.name}.zip`);
            archive.pipe(res);

            // Рекурсивно добавляем содержимое папки в архив
            await addFolderToArchive(folderPath, archive);

            // Финализируем архив и отправляем его клиенту
            archive.finalize();
        } catch (error) {
            console.error('Ошибка:', error);
            res.status(500).json({ message: 'Произошла ошибка при создании архива' });
        }
    }


    async downloadFileByLink(req, res, next) {
        try {
            const file = await File.findById({_id: req.query.id});
            if (!file) {
                return next(ApiError.notFound('Файл не найден'));
            }

            const path = fileService.getPath(req, file);
            if (fs.existsSync(path)) {
                return res.download(path, file.name);
            }

            return next(ApiError.badRequest({ message: "Ошибка загрузки" }));
        } catch (e) {
            console.log(e);
            return next(ApiError.internal({ message: "Ошибка загрузки" }));
        }
    }

    async openFile(req, res, next) {
        try {
            const file = await File.findById({ _id: req.query.id });
            if (!file) {
                return next(ApiError.notFound('Файл не найден'));
            }

            const path = fileService.getPath(req, file);

            // Проверяем, является ли файл разрешенным для открытия или скачивания
            if (isAllowedFileType(file.name)) {
                // Если файл разрешен, отправляем его клиенту
                if (fs.existsSync(path)) {
                    const readStream = fs.createReadStream(path);
                    return readStream.pipe(res);
                }
            } else {
                return next(ApiError.forbidden('Доступ к данному файлу запрещен'));
            }

            return next(ApiError.badRequest({ message: "Ошибка" }));
        } catch (e) {
            console.log(e);
            return next(ApiError.internal({ message: "Ошибка открытия" }));
        }
    }

    async deleteFile(req, res, next) {
        try {
            const file = await File.findOne({_id: req.query.id, user: req.user.id})
            const parent = await File.findOne({user: req.user.id, _id: file.parent})
            const user = await User.findOne({_id: req.user.id})
            if (!file) {
                return next(ApiError.badRequest({message: "Файл не найден"}))
            }

            user.usedSpace = user.usedSpace - file.size
            if (parent) {
                await updateDeleteParentFolderSize(parent._id, file.size)
            }
            fileService.deleteFile(req, file)

            await deleteFileAndChildren(file._id);


            await user.save()
            const token = generateJwtToken(user.id, user.email, user.diskSpace, user.usedSpace, user.role, user.avatar, user.name, user.surname)
            return res.json({message: "Файл был удален", usedSpace: user.usedSpace, token})
        } catch (e) {
            console.log(e)
            return next(ApiError.badRequest({message: "Ошибка удаления файла"}))
        }
    }

    async searchFile(req, res, next) {
        try {
            const searchName = req.query.search
            let files = await File.find({user: req.user.id})
            files = files.filter(file => file.name.includes(searchName))
            return res.json(files)
        } catch (e) {
            console.log(e)
            return next(ApiError.badRequest({message: "Ошибка поиска"}))
        }
    }



    async uploadAvatar(req, res, next) {
        try {
            const file = req.files.file
            console.log(file.name.split('.').pop())
            const user = await User.findById(req.user.id)

            if (user.avatar) {
                return next(ApiError.badRequest('Аватарка уже установлена'))
            }

            if (file.name.split('.').pop() !== 'jpg' && file.name.split('.').pop() !== 'png') {
                return next(ApiError.badRequest('Разрешено устанавливать только png и jpg аватарки'))
            }

            console.log('при загрузке размер файла' + file.size)
            user.usedSpace = user.usedSpace + file.size
            console.log('при загрузке ' + user.usedSpace)
            const avatarName = Uuid.v4() + ".jpg"
            file.mv(req.staticPath + "/" + avatarName)
            user.avatar = avatarName
            await user.save()
            const token = generateJwtToken(user.id, user.email, user.diskSpace, user.usedSpace, user.role, user.avatar, user.name, user.surname)
            return res.json({token, usedSpace: user.usedSpace})

        } catch (e) {
            console.log(e)
            return next(ApiError.badRequest({message: "Ошибка загрузки аватарки"}))
        }
    }

    async deleteAvatar(req, res, next) {
        try {
            const user = await User.findById(req.user.id)
            const avatarPath = req.staticPath + "/" + user.avatar

            const stats = await fs.promises.stat(avatarPath)
            const sizeInBytes = stats.size

            console.log('при удалении размер файла' + sizeInBytes)
            user.usedSpace = user.usedSpace - sizeInBytes
            console.log('при удалении ' + user.usedSpace)
            await fs.promises.unlink(avatarPath)

            user.avatar = null
            await user.save()
            const token = generateJwtToken(user.id, user.email, user.diskSpace, user.usedSpace, user.role, user.avatar, user.name, user.surname)
            return res.json({token, usedSpace: user.usedSpace})
        } catch (e) {
            console.log(e)
            return next(ApiError.badRequest({message: "Ошибка удаления аватарки"}))
        }
    }

}

module.exports = new FileController()