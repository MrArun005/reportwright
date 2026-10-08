// A section heading of the Inspector: its text is the toggle button inside the h5 (the CSS styles the row).
// Inspector.jsx toggles the section on click (Enter and Space are clicks on a button).
export default function CatHead({ children, ...rest }) {
  return <h5 {...rest}><button type="button" className="cat-toggle">{children}</button></h5>;
}
