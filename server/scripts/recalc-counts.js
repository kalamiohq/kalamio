import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Post from '../Schema/Post.js';
import User from '../Schema/User.js';
import Publication from '../Schema/Publication.js';

mongoose.connect(process.env.DB_LOCATION, { autoIndex: true }).then(async () => {
    console.log('Connected to DB');
    
    // Recalculate User total_posts
    const users = await User.find({});
    for (let user of users) {
        const countArticles = await Post.countDocuments({ author: user._id, draft: false, type: { $ne: 'text_post' } });
        
        if (user.account_info.total_posts !== countArticles) {
            console.log('User', user.personal_info.username, 'updating total_posts from', user.account_info.total_posts, 'to', countArticles);
            await User.updateOne({ _id: user._id }, { $set: { 'account_info.total_posts': countArticles } });
        }
    }

    // Recalculate Publication total_posts
    const pubs = await Publication.find({});
    for (let pub of pubs) {
        const countArticles = await Post.countDocuments({ publication: pub._id, draft: false, type: { $ne: 'text_post' } });
        if (pub.total_posts !== countArticles) {
            console.log('Publication', pub.title, 'updating total_posts from', pub.total_posts, 'to', countArticles);
            await Publication.updateOne({ _id: pub._id }, { $set: { total_posts: countArticles } });
        }
    }

    console.log('Done recalculating!');
    process.exit(0);
}).catch(err => console.error(err));
