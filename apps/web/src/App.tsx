import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Health from './pages/Health';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/health" element={<Health />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
