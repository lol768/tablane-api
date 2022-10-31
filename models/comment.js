const { Schema, model } = require('mongoose')

const commentSchema = new Schema({
    type: { type: String, enum: ['comment'] },
    author: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    content: Object,
    timestamp: String,
    task: {
        type: Schema.Types.ObjectId,
        ref: 'Task'
    }
})

module.exports = model('Comment', commentSchema)
