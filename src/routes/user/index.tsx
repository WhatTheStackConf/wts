import { Navigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";

const UserIndex = () => {
  const auth = useAuth();
  
  // If user is authenticated, redirect to profile; otherwise, to login
  if (auth && auth.isAuthenticated()) {
    return <Navigate href="/user/profile" />;
  } else {
    return <Navigate href="/login" />;
  }
};

export default UserIndex;