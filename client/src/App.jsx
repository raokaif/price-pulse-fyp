import React from 'react';
import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Verify from './pages/Verify';
import Forgot from './pages/Forgot';
import Reset from './pages/Reset';
import Profile from './pages/Profile';
import About from './pages/About';
import CategoryPage from './pages/CategoryPage';
import ProtectedRoute from './components/ProtectedRoute';

export default function App(){
  return (
    <div>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/:categoryId" element={<CategoryPage/>} />
        <Route path="/login" element={<Login/>} />
        <Route path="/signup" element={<Signup/>} />
        <Route path="/verify" element={<Verify/>} />
        <Route path="/forgot" element={<Forgot/>} />
        <Route path="/reset" element={<Reset/>} />
        <Route path="/profile" element={<ProtectedRoute><Profile/></ProtectedRoute>} />
        <Route path="/about" element={<About/>} />
      </Routes>
    </div>
  );
}
