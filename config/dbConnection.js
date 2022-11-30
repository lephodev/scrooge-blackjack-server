import mongoose from 'mongoose';

const mongoConnect = async () => {
  try {
    mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.log('Error in MongoDB Connection =>', error.message);
    process.exit(1);
  }
};

export default mongoConnect;
