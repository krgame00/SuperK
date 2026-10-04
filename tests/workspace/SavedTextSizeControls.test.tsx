import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,test,vi} from 'vitest';
import {SavedTextSizeControls} from '@/components/workspace/SavedTextSizeControls';
test('actual controls select explicit point and invoke point/page/book plus explicit Return Auto',async()=>{
  const resize=vi.fn().mockResolvedValue(1);
  render(<SavedTextSizeControls pageUrl="original" points={[{t:'หนึ่ง'},{t:'สอง'}]} busy={false} onResize={resize}/>);
  fireEvent.change(screen.getByLabelText('เลือกจุดปรับขนาด'),{target:{value:'1'}});
  fireEvent.click(screen.getByRole('button',{name:'เทียบขนาดจุดที่เลือก'}));
  await waitFor(()=>expect(resize).toHaveBeenLastCalledWith({scope:'point',pageUrl:'original',pointIndex:1}));
  fireEvent.click(screen.getByRole('button',{name:'กลับเป็น Auto จุดที่เลือก'}));
  await waitFor(()=>expect(resize).toHaveBeenLastCalledWith({scope:'point',pageUrl:'original',pointIndex:1,returnToAuto:true}));
  fireEvent.click(screen.getByRole('button',{name:'เทียบขนาดหน้านี้'}));
  await waitFor(()=>expect(resize).toHaveBeenLastCalledWith({scope:'page',pageUrl:'original'}));
  fireEvent.click(screen.getByRole('button',{name:'เทียบขนาดทั้งเล่ม'}));
  await waitFor(()=>expect(resize).toHaveBeenLastCalledWith({scope:'book'}));
});
test('point actions require explicit selection and busy disables all resizing',()=>{
  render(<SavedTextSizeControls pageUrl="original" points={[{t:'หนึ่ง'}]} busy={true} onResize={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'กลับเป็น Auto จุดที่เลือก'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'เทียบขนาดทั้งเล่ม'})).toBeDisabled();
});
